# repo-audit-delivery-agent

Agentic consulting tool for headless CMS codebase analysis.

## What it does

repo-audit-delivery-agent investigates headless CMS codebases (Sitecore XM Cloud/JSS and Optimizely SaaS CMS, both with Next.js) and produces structured, scored onboarding briefs. The agent autonomously decides what to investigate using deterministic tools, records findings with file-level evidence, and assembles a 12-section consulting deliverable with an architecture scorecard. It is not a linter or static analysis wrapper -- it reasons like a senior consultant, following human-authored rules loaded from markdown files.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) for system design and component map, [CHANGELOG.md](CHANGELOG.md) for release history.

## Quick Start

```bash
pnpm install
```

Create a `.env` file with your provider credentials (see [Provider Setup](#provider-setup) below), then run:

```bash
npx tsx src/index.ts analyze --repo <path-or-url> --goal onboarding
```

Example against a local repo:

```bash
npx tsx src/index.ts analyze --repo ../xmcloud-starter-js --goal onboarding --verbose
```

Example against a GitHub repo:

```bash
npx tsx src/index.ts analyze --repo https://github.com/Sitecore/xmcloud-starter-js --goal onboarding
```

## CLI Commands

### `analyze`

Run an agentic investigation on a repository.

```
npx tsx src/index.ts analyze [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <path>` | Repository local path or GitHub URL (required) | -- |
| `--goal <type>` | Analysis goal (see [Goals](#goals)) | `onboarding` |
| `--platform <name>` | Platform override: `sitecore`, `optimizely` | auto-detected |
| `--budget <n>` | Tool call budget | `45` |
| `--output <dir>` | Output directory | `./output` |
| `--verbose` | Show real-time agent reasoning and tool calls | off |
| `--json` | Output summary as JSON (for CI integration) | off |
| `--export` | Output full JSON export to stdout (all findings, log, metrics, sections) | off |
| `--github-output` | Post results to GitHub (issue for onboarding, PR comment for ci-check) | off |
| `--pr <number>` | PR number for ci-check goal comments (or set `GITHUB_PR_NUMBER`) | -- |
| `--resume <path>` | Resume from a checkpoint file (path to `.jsonl`) | -- |
| `--checkpoint-interval <n>` | Save checkpoint every N tool calls (0 to disable) | `5` |
| `--dry-run` | Show configuration without running the agent | off |

### `compare`

Run side-by-side comparison of two repositories. Produces individual briefs and a comparative summary highlighting relative strengths and gaps.

```
npx tsx src/index.ts compare --repos <path1> <path2> [--goal <type>] [--budget <n>]
```

### `tools`

List all registered tools and their parameters.

```
npx tsx src/index.ts tools --list
```

### `diff`

Compare findings between two runs. Matches by fingerprint, falls back to SHA-256 of category+filePath+title.

```
npx tsx src/index.ts diff <run-a.json> <run-b.json>
```

Output shows New, Resolved, and Persistent findings with a summary.

### `rules`

Validate that all expected consulting rule files exist for each goal/platform combination.

```
npx tsx src/index.ts rules --validate
```

## Goals

| Goal | Description |
|------|-------------|
| `onboarding` | Full 12-section consultant onboarding brief with scorecard, risks, and recommendations |
| `audit` | Scored architecture audit with weighted scoring rubric (type check 25%, lint 20%, tests 30%, dead code 15%, shell lint 10%) |
| `migration` | Migration readiness assessment with prioritized hotspots and complexity estimates |
| `component-map` | Structured component inventory showing CMS bindings, directives, and data fetching |
| `ci-check` | Fast CI health check (under 15 tool calls) producing pass/fail with blocking issues |
| `security-review` | Security audit across 6 categories with 22 false-positive exclusion rules and secrets archaeology (22 known credential prefixes) |
| `nextjs` | Next.js framework health audit across 7 categories (routing, data fetching, caching, etc.) |
| `accessibility` | WCAG 2.1 AA compliance audit across 6 categories with severity-mapped violations |

## Architecture

The system follows a strict separation: **tools are deterministic, orchestration is agentic, rules are human-authored, outputs are structured.**

```
Goal Prompt
    |
    v
+--------------------------------------------------+
|  Pi Agent (observe -> reason -> act)              |
|                                                   |
|  System instructions (consulting rules from .md)  |
|  Reference knowledge (platform-specific .md)      |
|  Pi AgentTools (23 deterministic functions)       |
|  Working state (findings, file cache, log)        |
+--------------------------------------------------+
    |
    v
Output Assembler -> scorecard + brief + JSON export
```

- **Tools** -- Pure functions that return facts (file contents, parsed configs, grep results, npm versions). They never call an LLM. Wrapped as Pi `AgentTool[]` with TypeBox schemas. 23 tools total; 3 infrequently-used tools are deferred-loaded via the `tool_search` meta-tool to save context tokens.
- **Rules** -- Plain English markdown files in `src/rules/` that shape the agent's priorities and quality standards. Editable by senior consultants without code changes.
- **References** -- Static knowledge files in `src/references/` (platform best practices, known antipatterns, compatibility matrices) loaded selectively by the agent.
- **Agent loop** -- Pi's `Agent` class handles tool dispatch, message threading, and loop control. `beforeToolCall`/`afterToolCall` hooks enforce budgets. The loop runs until `assemble_output` is called or the budget is spent.
- **Dual-model** -- Investigation phase uses `AGENT_MODEL` (Sonnet, heavy reasoning). The agent calls `switch_to_fast_model` when it decides investigation is complete, switching to `FAST_MODEL` (Haiku, cheaper) for finding assembly and brief writing. Fallback: force-switch at 5 calls remaining.
- **Tool concurrency** -- Pi's `toolExecution: 'parallel'` fires all tool calls from a single turn concurrently. Read-only tools (20 of 23) run fully parallel. Stateful tools (`record_finding`, `assemble_output`, `switch_to_fast_model`) self-serialize via an async mutex (`StatefulToolMutex`) so they never corrupt shared state, even when Pi fires them in the same batch.
- **Cost controls** -- Per-tool result size limits (grep: 20K, read_file: 65K, fetch_url: 100K, default: 4K) with disk spill to tmpdir for oversized results. 3-tier context compression (recent 10 messages full, mid-age 15 at 600 chars, older at 120 chars, cached by tool call ID). **Snip boundary**: when the model switches to Haiku, compression thresholds drop aggressively (mid-age to 80 chars, old to 40 chars), reducing context size by ~60% since the writing phase doesn't need raw investigation data. `onPayload` injects prompt cache breakpoints. Default budget is 45 calls. Session cost tracking persists per-run costs to JSONL for cross-run analysis.
- **Retry with per-error tiers** -- Each error class has its own retry limit: 429 rate-limit gets 8 attempts, 529 overload gets 3, 502/503 gets 5, connection errors (ECONNRESET/EPIPE/ETIMEDOUT) get 5. Respects `Retry-After` headers up to 2 minutes. Exponential backoff with 500ms base, 32s cap, 0-25% jitter. Stale connection detection triggers an `onStaleConnection` callback for diagnostics.
- **Ripgrep integration** -- `grep_pattern` tries `rg` first with JSON output parsing for structured results, then falls back to an optimized Node.js walker using `readdir({ withFileTypes: true })` when ripgrep isn't available. Either path respects the same ignore rules and result limits.
- **Defensive file handling** -- Binary files are detected via extension check + null-byte scan of the first 8KB and rejected before they waste tokens. When a file path doesn't exist, Levenshtein-based suggestions surface the top 3 similar filenames (distance ≤ 3) so the agent can self-correct typos without another exploratory tool call.
- **Monorepo detection** -- `detect_app_roots` scans for `package.json` files, classifies each by framework (Next.js, React, Angular, etc.), and detects monorepo tooling (workspaces, Turborepo, Nx, Lerna). The agent uses this early in investigation to scope its search to the right app root.
- **Confidence calibration** -- Every finding carries a 1-10 confidence score. 9-10 = verified in code, 7-8 = pattern match, 5-6 = needs confirmation, 3-4 = speculative. Findings with confidence ≤ 2 are excluded from scoring. The brief renders badges (`[verified]`, `[needs confirmation]`, `[speculative]`) and moves low-confidence findings to an appendix. CI comments only block on findings with confidence ≥ 7. During deduplication, the higher confidence wins.
- **Finding fingerprints** -- Each finding gets a SHA-256 fingerprint computed from `category + first evidence file path + normalized title`. The same logical finding produces the same fingerprint across runs regardless of description or severity changes. This enables cross-run trend tracking: compare two run exports to classify findings as Resolved (disappeared), Persistent (same fingerprint), or New (new fingerprint).
- **Session resume** -- Checkpoints are saved as JSONL every N tool calls (default 5), on error, and on budget exhaustion. `--resume <path>` hydrates prior state (findings, file cache, investigation log, model usage) and injects a natural-language summary of prior findings into the goal prompt so the agent picks up where it left off without re-investigating.
- **Security** -- Prompt injection defense wraps all tool outputs in context boundary delimiters and sanitizes instruction-like patterns (12 patterns including "ignore previous instructions", delimiter injection, boundary escape). Secret redaction strips KEY/SECRET/TOKEN/PASSWORD patterns plus AWS access keys (AKIA/ASIA/AROA/AIDA), connection strings, Bearer tokens, and PEM private keys from tool results before they enter LLM context or logs. The security-review goal includes 22 false-positive exclusion rules and secrets archaeology with 22 known credential prefix patterns.
- **Gateway** -- Portkey AI gateway routes to Amazon Bedrock via Pi's `openai-completions` Model with custom headers.
- **CI platform adapters** -- `CiPlatformAdapter` interface with GitHub Actions and Azure DevOps implementations, auto-detected from environment variables. Handles PR comments (update-in-place via marker), file-level annotations, SARIF upload, artifact management for trend tracking, auto-labels, and quality gates. Generic fallback for non-CI environments. All API calls via `ciApiFetch<T>()` with structured `{ok, status, data?, error?}` responses.
- **Output pipeline** -- Scorecard computation from findings, markdown brief rendering, full JSON export, SARIF 2.1.0 generation, and CI integration (orchestrated post-run via `orchestrateCi()`).

### Key Design Decisions

**Why confidence calibration matters for consulting delivery**

LLMs generate findings with varying certainty but traditionally present them all at the same confidence level. This creates noise -- a speculative "might have an XSS vector" sits next to a verified "hardcoded AWS key at line 47." Confidence calibration (1-10) solves this at every layer: scoring excludes speculation (≤ 2), CI only blocks on high-confidence issues (≥ 7), the brief visually distinguishes verified findings from speculative ones, and low-confidence observations go to an appendix instead of polluting the main report. The result is a report that reads like it came from a senior consultant who knows the difference between "I saw this" and "I think this."

**Why fingerprints enable trend tracking without a database**

Each finding gets a SHA-256 fingerprint from `category + first evidence file + normalized title`. The same logical issue (e.g., "outdated Next.js in package.json") produces the same hash across runs even if the description or severity changes. To track trends, diff two JSON exports by fingerprint: fingerprints in both = Persistent, only in old = Resolved, only in new = New. No database, no finding IDs to coordinate, no state server -- just two JSON files and a set intersection.

**Why the snip boundary saves real money**

The dual-model pattern (Sonnet investigates, Haiku writes) already saves ~37% vs running Sonnet for the full budget. But Haiku still receives the full conversation history including thousands of tokens of raw tool output from the investigation phase it will never reference. The snip boundary marks the model switch point and compresses all prior tool results to 40-80 characters. The writing phase context shrinks by ~60%, which directly reduces Haiku input token cost. Combined with prompt caching on the static system prompt, a typical 45-call run costs under $0.75.

**Why session resume uses prompt injection, not conversation replay**

When a run is interrupted (API error, budget exhaustion, network drop), the checkpoint saves the full agent state: findings, file cache, investigation log, model usage. But the LLM conversation history is gone -- Pi Agent doesn't persist it, and replaying 30+ turns would be expensive and fragile. Instead, resume injects a natural-language summary of prior findings into the goal prompt: "You previously found 7 findings across 3 categories. Here are the key ones..." The agent picks up investigation from context, not replay. This is cheaper, more robust, and avoids the "stale conversation" problem where replayed tool results no longer match disk state.

### Engineering Notes

**Budget enforcement and the afterToolCall timing guarantee**

The agent enforces web search and URL fetch budgets in `beforeToolCall`. The naive implementation increments the counter inside `execute()` — which creates a check-then-act race: if Pi fires two `web_search` calls in the same parallel batch, both pass the `beforeToolCall` check before either increments the counter. The fix is to move the increment to `afterToolCall`. This works because Pi doesn't start the next parallel batch until all `afterToolCall` hooks from the current batch have resolved. So `beforeToolCall` for batch N+1 always sees the fully-incremented counter from batch N.

**Why `filesRead.add()` can't follow the same pattern**

`read_file` and `read_files_batch` also mutate shared state — they add to `state.filesRead`, which `record_finding` checks to verify that each evidence file was actually read before being cited. The obvious fix is to move `filesRead.add()` to `afterToolCall` for consistency. This breaks things.

The reason: `record_finding` is a *stateful* tool serialized by `StatefulToolMutex`. Its `execute()` runs concurrently with `read_file.execute()` in the same parallel batch. If `record_finding.execute()` starts (as a mutex microtask) before `read_file`'s `afterToolCall` fires, `state.filesRead` is empty and all evidence gets rejected. The `afterToolCall` timing guarantee only applies between batches, not within a batch. `filesRead.add()` has to happen in `execute()` so it's visible to any concurrent stateful tool in the same turn.

**StatefulToolMutex: promise chain serialization**

`StatefulToolMutex` uses a self-advancing promise chain to serialize concurrent calls without a lock primitive:

```ts
serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = this._chain.then(fn, fn);
  this._chain = result.then(() => {}, () => {});
  return result;
}
```

`fn` is chained onto the current tail with `.then(fn, fn)` — the second `fn` argument means it runs whether the previous step succeeded or failed, so one throwing call doesn't deadlock the queue. The chain always advances via `result.then(noop, noop)`. No `Promise.race`, no polling, no external queue.

**Deferred tool loading**

23 tools is a lot of schema text in the system prompt. Frequently unused tools (`web_search`, `fetch_url`, `compare_versions`) have stub descriptions — enough for the agent to know they exist, not enough to waste context tokens on their full parameter lists. A `tool_search` meta-tool lets the agent discover full descriptions and schemas on demand by keyword. The agent only pays the token cost for tools it actually needs, and it self-discovers when it hits a task that needs them.

**Mid-loop model mutation**

Pi's `Agent._runLoop()` captures `const model = this._state.model` once at loop start and holds a reference for the entire run. The agent's `setModel()` method replaces `_state.model` with a new object — but the loop still holds the original reference. Calling `setModel()` mid-loop does nothing.

The fix: when `switch_to_fast_model` is called, `runner.ts` mutates the *original model object's properties in place* using `Object.assign(piModel, fastModelProps)`. The loop's captured reference now points to an object with the fast model's ID, token limits, and cost config. No abort, no restart — the next LLM call goes to Haiku.

### Evidence Verification

Every finding the agent records is cross-checked against the actual source code before it reaches the final report. This prevents hallucinated evidence -- a known failure mode where LLMs fabricate code snippets or misremember file contents after many tool calls push the original read out of context.

The verification system operates at three layers:

1. **Record-time verification** -- When `record_finding` is called, each evidence snippet is read from disk via `resolveAndRead()` and compared against the agent's claim. Mismatched snippets are auto-corrected to the real code; missing files have their evidence stripped. The agent receives warnings in the tool response so it can self-correct.

2. **Evidence chain tracking** -- Evidence is rejected if the agent cites a file it never read with `read_file` or `read_files_batch`. This prevents the agent from inferring file contents from names or neighboring files without actually opening them.

3. **Post-investigation verification pass** -- After the agent loop ends but before scorecard computation, every finding is re-verified. Findings where all evidence is unverifiable are removed entirely. A `verification_pass` step event is emitted and logged.

All verification is deterministic -- no LLM calls, no cost increase. Evidence in the final brief is tagged `[verified]`, `[corrected]`, or `[unverifiable]` so reviewers can see the verification status at a glance.

| Verification outcome | What happens |
|----------------------|--------------|
| **Verified** | Snippet matches actual file content. Included as-is. |
| **Corrected** | File exists but snippet differs. Replaced with real code, original preserved in `originalSnippet`. |
| **Rejected** | File doesn't exist, or agent never read it. Evidence item stripped from finding. |
| **Finding removed** | All evidence on a finding is unverifiable. Entire finding dropped before scoring. |

## Tool Catalog

| Tool | Description |
|------|-------------|
| `list_directory` | List files/directories at a path with configurable depth |
| `read_file` | Read file contents with language detection |
| `read_files_batch` | Read multiple files in one call |
| `grep_pattern` | Search for text/regex patterns across the repo |
| `find_files` | Find files matching a glob or name pattern |
| `parse_package_json` | Parse package.json for dependencies, scripts, workspaces |
| `parse_next_config` | Extract Next.js config (images, redirects, i18n, experimental) |
| `parse_tsconfig` | Parse TypeScript configuration and path aliases |
| `parse_env_file` | Parse .env files, returning variable names only (never values) |
| `check_gitignore` | Check whether specific patterns are in .gitignore |
| `query_npm_versions` | Fetch latest npm versions with 24h cache |
| `compare_versions` | Compare installed versions against latest, report drift severity |
| `analyze_route_structure` | Detect router type (pages/app/hybrid) and extract route map |
| `analyze_component_directives` | Scan for "use client"/"use server" directives, compute ratio |
| `analyze_env_usage` | Find process.env references, classify as public or server |
| `analyze_middleware` | Parse middleware for purpose (auth, i18n, multisite), matchers, imports |
| `detect_app_roots` | Scan for multiple app entry points (monorepo detection), classify by framework |
| `record_finding` | Record an investigation finding with category, severity, and evidence |
| `web_search` | Search the web for documentation and known issues |
| `fetch_url` | Fetch and extract text content from a documentation URL |
| `switch_to_fast_model` | Signal that investigation is complete, switch to cheaper model for writing |
| `assemble_output` | Signal the agent to assemble the final deliverable from accumulated findings |
| `tool_search` | Meta-tool: discover full schemas for deferred tools by keyword search |

## Dashboard

A Next.js dashboard for browsing investigation runs, replaying agent reasoning, and comparing results across repos.

```bash
pnpm dashboard
```

Features:
- **Live event stream** -- Watch the agent investigate in real time with grouped tool calls and reasoning steps
- **Replay mode** -- Step through completed investigations to understand the agent's decision-making
- **Run history** -- Browse past runs with sidebar navigation, persisted to disk
- **Dark/light/system theme** -- Manual toggle with system preference detection
- **Command palette** -- Keyboard-driven navigation (`Cmd+K` / `Ctrl+K`)
- **Radar branding** -- Terminal-inspired wordmark with typing animation

## Provider Setup

The agent uses the Portkey AI gateway to route requests to Amazon Bedrock. Create a `.env` file in the project root:

```
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_BASE_URL=https://portkeygateway.example.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
PROVIDER_TYPE=portkey

AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

| Variable | Purpose |
|----------|---------|
| `PORTKEY_API_KEY` | Portkey gateway API key |
| `PORTKEY_BASE_URL` | Portkey gateway base URL |
| `PORTKEY_PROVIDER` | Portkey provider routing header (e.g. `@aws-bedrock-use2`) |
| `PROVIDER_TYPE` | Provider type (`portkey` for production) |
| `AGENT_MODEL` | Heavy model for investigation and reasoning (first half of budget) |
| `FAST_MODEL` | Lightweight model for finding assembly and brief writing (second half) |

Model IDs are provider-agnostic. Swap to any provider's model IDs without code changes. Both models are built by `src/config/piModel.ts`. The agent decides when to switch via the `switch_to_fast_model` tool.

## Output Files

Each run writes to `output/<timestamp>/`:

| File | Contents |
|------|----------|
| `brief.md` | Full consulting brief with all 12 sections |
| `scorecard.json` | Architecture scorecard with per-category scores (red/yellow/green) |
| `findings.json` | All recorded findings with evidence, severity, and categories |
| `export.json` | Complete export: scorecard + findings + stack profile + investigation log |
| `investigation.md` | Step-by-step log of agent reasoning and tool calls |
| `investigation.html` | Browsable HTML investigation log with collapsible steps and inline scorecard |

| `*-checkpoint.jsonl` | Session checkpoints (append-only, for `--resume`) |
| `session-costs.jsonl` | Cross-run cost tracking (append-only) |

The onboarding brief includes these sections: Project Overview, Stack & Architecture, Key Files, CMS Integration, Preview & Editing, Configuration & Environment, Local Development Setup, Architecture Scorecard, Top Risks, First Week Reading List, Questions for the Client, and Suggested Next Actions.

## CI Integration

Radar auto-detects the CI platform from environment variables and runs the full integration automatically: PR comments, annotations, SARIF, artifact upload, labels, and quality gates.

### GitHub Actions

```yaml
- uses: ./.github/actions/radar
  with:
    portkey-api-key: ${{ secrets.PORTKEY_API_KEY }}
    portkey-base-url: ${{ secrets.PORTKEY_BASE_URL }}
```

Or run directly:

```bash
npx tsx src/index.ts analyze --repo . --goal ci-check --json
```

### Azure DevOps

Set `SYSTEM_ACCESSTOKEN` in your pipeline and radar detects the Azure DevOps environment automatically.

### Platform Detection

| Environment | Detected via | Adapter |
|-------------|-------------|---------|
| GitHub Actions | `GITHUB_ACTIONS=true` | `GitHubCiAdapter` — PR comments, check run annotations, SARIF upload, artifact management, labels |
| Azure DevOps | `TF_BUILD=True` | `AzureDevOpsCiAdapter` — PR thread comments, file-anchored annotations, pipeline artifacts |
| Other / Local | Neither set | `GenericAdapter` — exit code + stdout only |

### What happens in CI

1. **Trend tracking** — Downloads previous run's findings artifact, diffs against current (New/Resolved/Persistent)
2. **PR comment** — Scorecard table with collapsible findings by category, trend column, update-in-place via `<!-- radar-ci-comment -->` marker
3. **Annotations** — File-level annotations on the PR (capped at 30, sorted by severity)
4. **Labels** — Auto-labels PRs based on finding categories (e.g. `radar:security-review-needed`)
5. **SARIF** — Uploads SARIF 2.1.0 for GitHub Code Scanning (graceful fallback on 403)
6. **Quality gates** — Configurable via `config/quality-gates.json`. `failOn` returns exit 1, `warnOn` returns exit 0 with warning
7. **Webhook** — Fire-and-forget POST to Slack/Teams via `WEBHOOK_URL` env var

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All scorecard categories are green or yellow (or quality gate passes) |
| `1` | Quality gate triggered (red score or new critical findings) |
| `2` | Agent error (partial output may be written) |

### JSON Output

The `--json` flag outputs a CI-friendly summary including status, overall score, finding count, tool call count, duration, estimated cost, per-category scores, top risks, and `ciOperations` array (one entry per CI adapter operation with status and error details).

### Docker

A multi-stage Docker image is published to GHCR on each release:

```bash
docker run ghcr.io/aberhamm/repo-audit-delivery-agent:latest analyze --repo /repo --goal ci-check --json
```

## Development

### Prerequisites

- Node.js 20+
- pnpm

### Testing

```bash
# Run all tests
pnpm test

# Unit tests only (tool tests against test/fixtures/sitecore-minimal/)
pnpm test:unit

# E2e tests (requires LLM provider, ~60s timeout)
pnpm test:e2e

# Watch mode
pnpm test:watch
```

### Project Structure

```
src/
  index.ts              CLI entry point (Commander)
  agent/
    runner.ts           Pi Agent runner -- creates Agent, hooks, post-loop output
    goalPrompts.ts      Goal-specific prompt templates
    systemPrompt.ts     Rule loader and system prompt assembler
    retry.ts            Per-error-type retry tiers with Retry-After, stale connection detection
    contextBoundary.ts  Prompt injection defense (boundary wrapping, pattern detection, sanitization)
    redaction.ts        Secret redaction (KEY/SECRET/TOKEN/PASSWORD patterns)
  tools/
    piToolAdapter.ts    All 23 tools as Pi AgentTool[] with TypeBox schemas + per-tool result limits + disk spill
    repo/               list_directory, read_file, read_files_batch
    search/             grep_pattern (ripgrep + Node.js fallback), find_files
    config/             parse_package_json, parse_next_config, parse_tsconfig, parse_env_file, check_gitignore
    dependency/         compare_versions, query_npm_versions
    analysis/           analyze_route_structure, analyze_component_directives, analyze_env_usage, analyze_middleware, detect_app_roots, record_finding (with fingerprinting), verify_evidence, deduplicate_findings
    utils/              resolveAndRead (binary detection, ENOENT suggestions, path traversal guard)
    web/                web_search, fetch_url (10MB response size cap)
  rules/                Consulting rules (markdown), 11 files
    core.md             Shared investigation rules + confidence calibration scale
    goal-onboarding.md  Onboarding brief requirements
    goal-audit.md       Audit scoring criteria + weighted rubric
    goal-migration.md   Migration assessment rules
    goal-ci-check.md    CI health check (3 categories, compact output)
    goal-security-review.md  Security audit + 22 FP exclusions + secrets archaeology
    goal-nextjs.md      Next.js framework health (7 categories)
    goal-accessibility.md   WCAG 2.1 AA compliance (6 categories)
    goal-component-map.md   Component inventory rules
    platform-sitecore.md    Sitecore-specific investigation rules
    platform-optimizely.md  Optimizely-specific investigation rules
  references/           Static knowledge base (markdown)
    consulting/         Quality bar, risk severity guide, client question patterns
    sitecore/           XM Cloud architecture, JSS compatibility, editing patterns, antipatterns
    optimizely/         Content Graph setup, Visual Builder, SDK compatibility, antipatterns
    nextjs/             App Router migration, caching, server components, security headers
  ci/
    adapter.ts          CiPlatformAdapter interface, factory (auto-detect GitHub/Azure/Generic), GenericAdapter
    github.ts           GitHub Actions adapter (REST API, check run annotations, SARIF, artifacts)
    azureDevops.ts      Azure DevOps adapter (PR threads, file-anchored annotations, pipeline artifacts)
    orchestrator.ts     orchestrateCi() — coordinates all CI ops post-run (diff, comment, annotations, labels, SARIF, artifacts, webhook)
    qualityGate.ts      Configurable fail/warn thresholds from config/quality-gates.json
    webhook.ts          Fire-and-forget Slack/Teams POST with SSRF protection
    utils.ts            ciApiFetch<T>(), maskToken(), deriveLabels(), ciLog()
  commands/
    analyze.ts          Main analyze command handler
    compare.ts          Side-by-side repo comparison
    diff.ts             radar diff — compare findings between runs via fingerprint matching
  output/
    scorecard.ts        Scorecard computation from findings (confidence-gated)
    brief.ts            Markdown brief renderer (confidence badges, low-confidence appendix)
    json.ts             Full JSON export builder
    ciComment.ts        CI PR comment renderer (collapsible findings, trend column, 60K truncation)
    sarif.ts            SARIF 2.1.0 generator (severity mapping, fingerprint support)
    investigationHtml.ts  Static HTML investigation log with collapsible steps
    sessionCosts.ts     Cross-run cost persistence (JSONL append)
    sessionCheckpoint.ts  Checkpoint save/load with Set/Map serialization
  config/
    piModel.ts          Pi Model builder (env vars -> agent + fast Model<'openai-completions'>)
    model-pricing.json  Per-model token pricing for cost estimates
  types/
    state.ts            AgentState, Finding, GoalType, StackProfile
    findings.ts         Finding, Evidence, Severity, Confidence, Fingerprint
    checkpoint.ts       CheckpointEntry, SerializedAgentState
    output.ts           Scorecard, RunMetrics
config/
  quality-gates.json    Default quality gate thresholds (failOn/warnOn)
docs/
  spec.md               Full implementation spec
  designs/              Design documents and plans
test/
  fixtures/             Test fixture repos (sitecore-minimal)
  tools/                Unit tests per tool
  agent/                Retry (29 tests), system prompt, goal prompts, step events
  ci/                   CI adapter, GitHub, Azure DevOps, orchestrator, quality gate, webhook tests
  security/             Context boundary, redaction
  output/               Scorecard, brief, CI comment, SARIF, session costs, checkpoints
  commands/             CLI command handlers (analyze, compare, diff)
  dashboard/            Agent session, run transforms, rules route
  e2e/                  End-to-end agent loop tests (onboarding, nextjs, accessibility)
```

## License

ISC
