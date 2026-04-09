# Radar Code Walkthrough

How the code works, traced end to end. Written so you can explain it confidently in a demo or technical Q&A.

---

## 1. Entry Points

There are two ways to start a run — CLI and dashboard. Both end up calling the same `runAgent()` function.

### CLI Path

**`src/index.ts`** — Commander.js CLI with 6 commands. The one that matters is `analyze`, which calls `handleAnalyze()` in `src/commands/analyze.ts`.

`handleAnalyze()` is a thin orchestration layer:

1. **Resolves the repo** — if it's a GitHub URL, calls `cloneRepo()` to shallow-clone it. If local, just resolves the path.
2. **Pre-fetches npm versions** — calls `queryNpmVersions()` for a standard set of tracked packages (cached 24h). This data is available to the agent via the `compare_versions` tool later.
3. **Calls `runAgent()`** — passes the repo path, goal, budget, and callbacks for verbose output and budget extension.
4. **Post-run**: detects CI platform (`detectCiPlatform()`), runs `orchestrateCi()` if in GitHub Actions or Azure DevOps, prints summary, returns exit code (0 = green/yellow, 1 = red, 2 = error).

### Dashboard Path

**`dashboard/src/app/api/run/route.ts`** receives a POST request. It dynamically loads `src/agent/runner.ts` via tsx (bypasses webpack entirely because the agent source tree is too heavy for it), and calls the same `runAgent()` function.

The difference: the dashboard runs it asynchronously and streams events back to the browser via SSE. The `onStep` callback pushes events to an SSE `ReadableStream` controller. The `onBudgetExhausted` callback returns a `Promise<boolean>` that pauses the agent — the dashboard shows "Extend" / "Finish" buttons, and `POST /api/extend-budget` resolves the promise.

Same `runAgent()`, different I/O layer.

---

## 2. The Agent Runner — `src/agent/runner.ts`

This is the biggest file and the core of the system. Here's what happens inside `runAgent()`, step by step.

### Step 1: Initialize State (lines 233–256)

Creates the `AgentState` object — a mutable bag that tracks everything during the run:

- `findings` — accumulated findings array
- `filesRead` — Set of files the agent has read (used for evidence verification)
- `fileReadCache` — Map of file path → content (used to verify snippets)
- `toolCallCount` / `toolCallBudget` — budget tracking
- `investigationLog` — step-by-step log of what the agent did
- `modelUsage` — per-model token counts for cost tracking

Every tool reads from or writes to this state object.

### Step 2: Pre-Compute (lines 298–311)

Before the LLM ever runs, three deterministic tools execute in parallel:

- `detectAppRoots()` — identifies Next.js app roots, monorepo structure
- `parsePackageJson()` — reads package.json for dependencies and scripts
- `listDirectory()` — top-level file tree (depth 2)

Then `getSpecialistPrompts()` chains off the app roots result to load technology-specific checklists. This saves 3–5 LLM round-trips because the agent would always do these first anyway. The results get injected into the goal prompt as "PRE-COMPUTED CONTEXT" so the agent can skip straight to deeper investigation.

### Step 3: Build the System Prompt (line 314)

`buildSystemPrompt()` in `src/agent/systemPrompt.ts` is simple — reads markdown files from `src/rules/` and concatenates them:

1. `core.md` — always loaded (investigation standards, finding standards, evidence integrity rules)
2. `platform-sitecore.md` or `platform-optimizely.md` — loaded if the platform is known
3. `goal-audit.md` (or whichever goal) — always loaded

Plus a boundary instruction for prompt injection defense. That's it — the system prompt is just concatenated markdown.

### Step 4: Build the Goal Prompt (lines 315–319)

`buildGoalPrompt()` in `src/agent/goalPrompts.ts` returns the initial user message. Each goal type has a template:

- **What to do**: "Produce a scored architecture audit for this project."
- **Budget instructions**: "Spend 60% investigating, 25% recording, 15% assembling."
- **Model switch instructions**: "Call `switch_to_fast_model` when you're done investigating."
- **Confidence calibration**: "9–10 = confirmed in code, 5–6 = indirect evidence, 3–4 = speculative."
- **Category coverage**: "You MUST record at least one finding in each of these categories: ..."
- **Documentation URLs**: list of official docs the agent can fetch if needed

### Step 5: Build Tools (line 329)

`buildPiTools()` in `src/tools/piToolAdapter.ts` wraps all 23 tool implementations as Pi `AgentTool[]` objects with TypeBox schemas for argument validation. Each tool's `execute()`:

1. Runs input validation from `validators.ts`
2. Normalizes file path arguments (strips absolute prefixes, fixes separators)
3. Calls the raw implementation function
4. Tracks state side effects (files read, etc.)
5. Returns Pi's `{ content, details }` result format

Also returns a ref object (`assembledRef`) — a closure that captures the sections written by `assemble_output`, accessible after the loop ends.

### Step 6: Build Models (lines 331–343)

`buildPiModel()` in `src/config/piModel.ts` reads env vars and builds two Pi Model objects:

```
PORTKEY_API_KEY → API key for the gateway
PORTKEY_BASE_URL → Gateway URL
PORTKEY_PROVIDER → Routing header (e.g., @aws-bedrock-use2)
AGENT_MODEL → Investigation model ID (Sonnet)
FAST_MODEL → Writing model ID (Haiku)
```

Both are `Model<'openai-completions'>` objects. Pi Agent speaks OpenAI-compatible API. Portkey gateway translates to the actual provider (Bedrock, Azure, etc.). To switch providers, you change the env vars — no code changes.

### Step 7: Create the Pi Agent (lines 663–676)

```typescript
const agent = new Agent({
  initialState: { systemPrompt, model: piModel, thinkingLevel: 'off', tools },
  toolExecution: 'parallel',
  transformContext,
  onPayload,
  getApiKey: async () => apiKey,
  beforeToolCall,
  afterToolCall,
});
```

Key configuration:

| Setting | What it does |
|---------|-------------|
| `toolExecution: 'parallel'` | Pi fires tool calls in parallel batches — if the LLM requests 3 tools in one turn, they all run concurrently |
| `transformContext` | Compresses old messages to control context window size (3-tier: recent = full, mid-age = 600 chars, old = 120 chars) |
| `onPayload` | Injects `cache_control` breakpoints for Anthropic prompt caching |
| `beforeToolCall` | Budget enforcement — blocks tools when budget is exhausted (except `assemble_output`, which is always allowed as the exit path) |
| `afterToolCall` | The big one — see next section |

### Step 8: The `afterToolCall` Hook — Where Everything Happens

After every single tool call, this hook runs (lines 439–577). It:

1. **Increments counters** — tool call count, web search count, etc.
2. **Logs the step** — pushes to `state.investigationLog` with truncated reasoning and result
3. **Emits a step event** — fires `config.onStep()` for CLI verbose output or dashboard SSE
4. **Saves periodic checkpoints** — every N tool calls, writes a JSONL checkpoint to disk
5. **Handles `switch_to_fast_model`** — when the agent calls this tool, the hook mutates `piModel` in place to switch from Sonnet to Haiku (see "The Model Switch Trick" below)
6. **Checks for prompt injection** — validates finding content doesn't contain instruction-like patterns
7. **Detects `assemble_output`** — if the agent called this tool and sections were captured, sets `terminationReason = 'completed'` and calls `agent.abort()` to exit the loop
8. **Wraps tool output** — applies secret redaction and boundary delimiters before returning to LLM context
9. **Sends budget warnings** — at 50% budget remaining, steers the agent to switch models. At 5 calls remaining, force-switches and tells the agent to call `assemble_output` NOW

### Step 9: Run the Loop (line 761)

```typescript
await withRetry(() => agent.prompt(goalPrompt), { ... });
```

`agent.prompt()` is Pi's main loop — sends the goal prompt, gets the LLM's response, executes any tool calls, feeds results back, and repeats until the LLM stops requesting tools. `withRetry()` handles transient API errors (429 rate limits, 529 overloads, connection drops) with exponential backoff.

This is where the agent spends its time. The LLM sees the system prompt (rules), the goal prompt, and the accumulated conversation history (tool calls and results), and decides what to do next. There's no hardcoded sequence — the LLM picks tools based on what it's learned so far.

### Step 10: Post-Loop Nudging (lines 776–819)

If the agent finished without calling `assemble_output` (common when budget runs out), the runner nudges it up to 2 times:

> "You must call assemble_output now with written content for all required sections."

If nudging fails, `autoAssembleFromFindings()` builds minimal sections from recorded findings without any LLM call — groups findings by category and formats them as markdown.

### Step 11: Post-Loop Verification (lines 853–888)

Two deterministic passes, no LLM involved:

**Evidence verification** — re-reads every finding's cited files from disk, compares snippets against the actual code. Findings where ALL evidence is unverifiable get removed entirely.

**Deduplication** — merges findings with overlapping evidence and similar titles/categories. Prevents inflated risk counts from the same issue being recorded multiple times.

### Step 12: Scorecard Computation (line 890)

`computeScorecard()` in `src/output/scorecard.ts` — pure function. Groups findings by category, counts severities per category:

- **Red:** any critical finding, or 3+ high
- **Yellow:** any high finding, or 3+ medium
- **Green:** only medium, low, or info

Overall score: red if any category is red, yellow if any is yellow, green otherwise. Top risks: up to 5 highest-severity findings, sorted by severity then confidence.

### Step 13: Render and Write Outputs (lines 895–915)

All rendering is deterministic — no LLM calls:

- `renderBrief()` → markdown deliverable with scorecard, sections, top risks
- `buildFullExport()` → full JSON export (all findings, investigation log, metrics, sections)
- `writeOutputFiles()` → writes 6 files to disk (scorecard JSON, brief markdown, findings JSON, full export JSON, investigation log markdown, investigation log HTML)
- `saveSessionCost()` → appends cost entry to `costs.jsonl` for cross-run tracking

---

## 3. The Model Switch Trick

This is architecturally interesting and worth understanding.

Pi's `_runLoop()` captures `const model = this._state.model` once at loop start. If you call `agent.setModel(newModel)`, it replaces the `_state` reference — but the loop still holds the old object. It won't see the change.

Solution: `switchModelInPlace()` (line 366) does:

```typescript
Object.assign(piModel, {
  id: piFastModel.id,
  name: piFastModel.name,
  cost: piFastModel.cost,
  maxTokens: piFastModel.maxTokens,
});
```

This mutates the original object's properties. Since the loop holds a reference to that same object, it sees the change immediately — no abort/restart needed. The next LLM call goes to Haiku instead of Sonnet.

The switch is agent-initiated. The agent calls `switch_to_fast_model` when it decides investigation is done. Fallbacks:
- At 50% budget remaining: a steering message reminds the agent to switch
- At 5 calls remaining: the runner force-switches

After the switch, a "snip boundary" activates — context compression drops from 600/120 char limits to 80/40 chars for old messages, because the writing phase doesn't need raw file contents anymore. This gives the writing model a cleaner, smaller context.

---

## 4. Evidence Verification — `src/tools/analysis/recordFinding.ts`

This is the anti-hallucination system.

When the agent calls `record_finding`:

**1. Parse the arguments** — `extractFindings()` handles 6+ different shapes the LLM might produce:
- `{ finding: { id, category, ... } }` — correct per schema
- `{ id, category, ... }` — flat, no wrapper
- `{ finding: { finding: { ... } } }` — double-nested
- `{ finding: [ {...}, {...} ] }` — array of findings
- `{ "0": {...}, "1": {...} }` — array serialized as object keys

This robustness is necessary because LLMs don't always follow schemas perfectly.

**2. Verify each evidence item:**
- Check `state.filesRead` — was this file actually read during the run? If the agent cites a file it never read, the evidence is **rejected**.
- Call `verifyAndCorrectEvidence()` — reads the real file from disk, compares the snippet the LLM provided against the actual content. If the snippet doesn't match, it **auto-corrects** to the real code. If the file doesn't exist, the evidence is **rejected**.

**3. Compute fingerprint:**
```
SHA-256(category + filePath + normalizedTitle)
```
This enables cross-run trend tracking — the same logical finding produces the same fingerprint across runs, even if the description or severity changes.

**4. Push to state** — the verified finding goes into `state.findings`.

After the loop, a second pass (`verifyFindingEvidence`) re-checks everything against disk and removes findings where all evidence failed verification.

---

## 5. Context Compression — `transformContext` Callback

The LLM conversation grows with every tool call — raw file contents, grep results, etc. Without compression, you'd blow the context window fast.

The `transformContext` callback (lines 603–637) implements 3-tier compression:

| Tier | Messages | Treatment |
|------|----------|-----------|
| **Tier 1 (recent)** | Last 10 messages | Full fidelity — untouched |
| **Tier 2 (mid-age)** | Next 15 messages | Tool results truncated to 600 chars |
| **Tier 3 (old)** | Everything older | Tool results truncated to 120 chars |

Only tool result messages are compressed — assistant and user messages pass through unchanged. Summaries are cached by tool call ID so they don't get recomputed every turn.

After the model switch (snip boundary), limits tighten to 80/40 chars — the writing phase doesn't need the raw investigation data.

---

## 6. The Tools Layer — `src/tools/`

23 tools, all deterministic. They never call an LLM. They read code and return structured data.

Each tool is a standalone TypeScript function in its own file:
- Takes `(repoPath: string, input: TypedInput)` as arguments
- Returns a typed output object
- Has no side effects beyond updating `AgentState` (and only `recordFinding` does that)

`buildPiTools()` in `piToolAdapter.ts` wraps each function as a Pi `AgentTool` with:
- TypeBox schema for argument validation
- Path normalization (LLMs sometimes pass absolute paths, backslashes, etc.)
- State tracking (adds to `filesRead` on file reads)
- Concurrency control: 20 tools are read-only and run fully parallel. 3 stateful tools (`record_finding`, `assemble_output`, `switch_to_fast_model`) serialize via `StatefulToolMutex` — a lock-free promise chain

---

## 7. The Rules Layer — `src/rules/`

17 markdown files loaded at runtime. The agent sees these as its system prompt.

**`core.md`** — always loaded. Defines:
- Starting points: "Always begin by reading package.json"
- Investigation priorities: "Preview and editing mode is the #1 source of client escalations"
- Finding standards: "Minimum 8 findings. Every category needs at least one."
- Evidence integrity: "You may ONLY record findings about files you have read"
- Confidence calibration: "9–10 = read the exact code, 5–6 = indirect evidence"

**Goal rules** (e.g., `goal-audit.md`) — define what the specific goal type cares about and how to score it.

**Platform rules** (e.g., `platform-sitecore.md`) — CMS-specific patterns, anti-patterns, and what to look for.

**Specialist rules** (`src/rules/specialists/`) — loaded on demand when the agent detects specific technologies (GraphQL, Tailwind, Prisma, etc.).

Adding a new audit type = writing a markdown file. No code changes.

---

## 8. CI/CD Integration — `src/ci/`

7 files handling post-analysis automation.

**`adapter.ts`** — defines the `CiPlatformAdapter` interface and `detectCiPlatform()` factory. Checks env vars: `GITHUB_ACTIONS` → GitHub adapter, `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` → Azure DevOps adapter, otherwise → generic fallback.

**`orchestrator.ts`** — the main flow after analysis completes:
1. Download previous run artifacts (for trend tracking)
2. Diff findings by fingerprint (new / resolved / persistent)
3. Post PR comment with scorecard and finding diff
4. Add file-level annotations on specific lines
5. Upload SARIF for GitHub Code Scanning
6. Apply labels (`radar:security-risk`, `radar:clean`, etc.)
7. Upload run artifacts for next-run comparison
8. Fire webhooks (Slack/Teams)
9. Evaluate quality gate → exit code

**`qualityGate.ts`** — evaluates pass/fail thresholds from config. Exit code 0 = pass, 1 = fail, 2 = error.

Trend tracking is fingerprint-based — no database needed. Previous run's JSON is stored as a CI pipeline artifact and downloaded for comparison.

---

## 9. Scorecard Computation — `src/output/scorecard.ts`

Pure function. Maps finding categories to display categories (e.g., `security` + `configuration` → "Security & Configuration"). Different goal types have different category maps:

- Onboarding: 7 categories (Stack, CMS Integration, Preview, Security, Architecture, Dependencies, Deployment)
- Security Review: 6 categories (Secrets, Auth, Headers, Dependency Security, Input Validation, Data Exposure)
- Next.js: 7 categories (Router, Data Fetching, Rendering, Performance, Config, Dependencies, TypeScript)
- Accessibility: 6 categories (Images, Semantic Structure, Keyboard, Forms, Color, Dynamic Content)

Scoring per category:
- **Red:** any critical, or 3+ high
- **Yellow:** any high, or 3+ medium
- **Green:** only medium/low/info

Top risks: up to 5 highest-severity findings, sorted by severity then confidence as tiebreaker.

---

## 10. The Key Insight

The LLM only does two things:

1. **Decide which tools to call** — based on the rules and what it's learned so far
2. **Write the narrative** — descriptions, recommendations, section content

Everything else is deterministic TypeScript:
- Reading files → tools
- Verifying evidence → `verifyAndCorrectEvidence()`
- Computing scores → `computeScorecard()`
- Rendering output → `renderBrief()`, `buildFullExport()`
- Enforcing budgets → `beforeToolCall` / `afterToolCall` hooks
- Switching models → `switchModelInPlace()`
- Posting to CI → `orchestrateCi()`

The LLM is the judgment layer. The code is the safety net.
