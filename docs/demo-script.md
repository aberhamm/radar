# Radar Demo Script

Full script for the April 26 demo. Read top to bottom. Stage directions are in **bold**. Lines to say are in blockquotes. Timestamps are cumulative from start.

---

## Pre-Flight Checklist

Complete all of these 30 minutes before go-time.

### 1. Generate the demo run

You need a completed `goal=all` run in the sidebar. This takes ~8-10 minutes and costs ~$7-8.

```bash
# Verify auth
source .env && echo $PORTKEY_API_KEY | head -c5

# Smoke test (should list 23 tools)
npx tsx src/index.ts tools

# Clone the demo repo if you haven't already
git clone --depth 1 https://github.com/Sitecore/xmcloud-starter-js tmp/sitecore-xmcloud

# Run all goals to build the demo fixture
npx tsx src/index.ts analyze --repo tmp/sitecore-xmcloud --goal all --verbose

# Start dashboard
pnpm dashboard
```

### 2. Prepare GitHub Issues demo

You need a **private test repo** to push issues into. Don't create issues against Sitecore's actual repo.

```bash
# Create a throwaway repo (or use an existing test repo)
gh repo create my-radar-demo-issues --private --confirm

# Ensure GITHUB_TOKEN is set in dashboard/.env.local
echo "GITHUB_TOKEN=$(gh auth token)" >> dashboard/.env.local
```

### 3. Final checklist

- [ ] Pre-generated `goal=all` run visible in sidebar
- [ ] `pnpm dashboard` running, browser at `localhost:3000`
- [ ] Light mode on
- [ ] VS Code open with tabs in order:
  1. `src/rules/goal-security-review.md`
  2. `src/config/piModel.ts`
  3. `src/agent/runner.ts` (scrolled to ~line 795)
  4. `src/agent/runner.ts` (split/bookmarked at ~line 462)
  5. `src/agent/budgetPlanner.ts`
  6. `src/tools/analysis/recordFinding.ts`
  7. `src/agent/contextBoundary.ts`
- [ ] GitHub URL in clipboard: `https://github.com/Sitecore/xmcloud-starter-js`
- [ ] Test repo name memorized: `your-username/my-radar-demo-issues`

---

## The Arc

| Act | What happens | Time | Audience feeling |
|-----|-------------|------|-----------------|
| **Hook** | The question | 0:00 | "Wait, what?" |
| **Act 1** | Kick off a live run | 0:30 | "It's alive" |
| **Act 2** | Architecture + code walkthrough (while it runs) | 2:00 | "This is well-engineered" |
| **Act 3** | Multi-goal scoreboard + findings (replay) | 9:00 | "Those are real findings" |
| **Act 4** | Create GitHub Issues live | 13:00 | "It just did that?" |
| **Act 5** | The numbers + the close | 16:00 | "How do I get this?" |

---

## 0:00 — THE HOOK

**Screen: anywhere, doesn't matter yet.**

> I want to show you something we've been building.
>
> Imagine a prospect sends us their repo for a health check. Today that takes a senior architect a week. Reading through the codebase, checking security, accessibility, architecture patterns, writing up findings.
>
> What if an AI agent could run all of those assessments in one sweep, in under 10 minutes, for about 7 dollars, and hand the architect a scored report with file-level evidence to start from?

**Don't pause. Open the dashboard immediately.**

---

## 0:30 — ACT 1: KICK OFF THE LIVE RUN

**Screen: Dashboard idle view. Clean form, goal selector, sidebar with history.**

> This is Radar. You give it a repository, pick what kind of analysis you want, and an AI agent autonomously investigates the codebase.

**Click the goal dropdown. Hold it open for 3 seconds. Let them read.**

> Ten goal types. Security review, architecture audit, accessibility, developer onboarding, Next.js health, migration readiness, CI checks.
>
> Each one follows its own set of consulting rules. Plain English markdown, not code. You can read them, edit them, write new ones.

**Point at "All Goals" in the dropdown.**

> All Goals runs every applicable assessment against the same repo in one sweep. That's the full diagnostic.

**Paste the GitHub URL into the repo field. Click "Pull Repo."**

> This is Sitecore's official XM Cloud starter kit. Their Next.js headless CMS template. Real production code, the starting point for new Sitecore projects.

**Wait for clone to finish. Select "All Goals." Click Start.**

> That's now running live. The agent is working through security, architecture, accessibility, onboarding, everything. Takes about 8 minutes.

**Let the investigation view stream for 10-15 seconds. Let them see tool call chips fly by.**

> Watch the tool calls on the left. Reading package.json, detecting the framework, scanning the directory structure. No hardcoded sequence. The agent decides what to investigate based on what it finds.

> While this runs in the background, let me show you how it works under the hood. We'll come back for the results.

---

## 2:00 — ACT 2: ARCHITECTURE + CODE WALKTHROUGH

**Switch to VS Code.**

---

### 2:00 — The Four Layers

*Describe verbally — four layers as an execution flow:*

> The architecture is four layers, and the principle is simple.

> First: consulting rules. Plain English markdown files. Core rules that every run follows, platform rules for Sitecore or Optimizely, goal rules for each assessment type. They define the mission.

> Second: the Pi Agent runtime. An observe-reason-act loop. It loads the rules into its system prompt, then decides which tools to call and in what order. That's where the intelligence lives.

> Third: 23 deterministic tools. They read files, search code, parse configs, query npm. They return facts. They never call an LLM. They never reason. The agent calls them; they don't know the agent exists.

> Fourth: structured output. Scorecards, findings, briefs, PDFs, SARIF, GitHub Issues. Schema-enforced, evidence-verified, scored.

> No layer reaches into another. Tools don't know about rules. Rules don't know about output formats. The agent sits in the middle and connects them.

---

### 3:00 — Rules Are Markdown

**Show tab: `src/rules/goal-security-review.md`. Scroll slowly.**

> This is a goal rule file. Plain English markdown. It tells the agent what categories to investigate: auth, secrets, injection, headers, dependencies, data exposure.
>
> It defines severity criteria. What patterns to look for, what counts as evidence.

**Point at a specific instruction in the file.**

> You want a new audit type, say performance or GraphQL security, you write one of these files. No code changes. The agent picks it up on the next run. The expertise lives in the rules, not in the codebase.

---

### 3:30 — Provider-Agnostic Model Config

**Show tab: `src/config/piModel.ts`. The whole file is ~77 lines.**

> The model config is two models built entirely from environment variables.

**Point at `model` and `fastModel` objects.**

> The agent model is for investigation. The fast model is for writing. Role-based names, not model names. The code never says "Sonnet" or "Haiku."
>
> You change two env vars to any provider's model IDs. Swap from AWS Bedrock to Azure OpenAI, no code changes. That's how a client runs this on their own infrastructure.

---

### 4:00 — The Pi Agent Wiring

**Show tab: `src/agent/runner.ts`, scrolled to ~line 795.**

> This is the core. Pi Agent gives us an `Agent` class. We give it a system prompt (assembled from those markdown rules), a model, and 23 tools. Then we call `agent.prompt()` and it runs autonomously.

**Point at the `new Agent({...})` block. Walk through the properties.**

*On screen — the Agent constructor:*

```typescript
const agent = new Agent({
  initialState: { systemPrompt, model: piModel, thinkingLevel: 'off', tools },
  toolExecution: 'parallel',
  transformContext, onPayload,
  beforeToolCall, afterToolCall,
});
```

> The interesting parts are the hooks we attach.

> `toolExecution: 'parallel'` means Pi fires all tool calls from a single LLM turn concurrently. The agent wants to read five files at once? They all run in parallel.

> `beforeToolCall` is budget enforcement. Every tool call goes through this gate. It blocks calls when the budget runs out. It enforces per-tool quotas: web search gets 5 calls max, URL fetching gets 3.
>
> And if the agent has spent 75% of its budget with zero findings recorded, it locks out all investigation tools and forces the agent into recording mode. The agent can't burn the whole budget without producing anything.

> `afterToolCall` is state tracking. Every tool call increments counters, logs the investigation step, checks if it's time to send a steering message. At 50% budget it nudges the agent to switch to the cheaper model. At 5 calls remaining it sends a critical message.

> `transformContext` is context compression. How we keep the conversation under the context window. I'll show you this in a second.

> `onPayload` is prompt caching. We inject cache control breakpoints so the system prompt and all 23 tool definitions are cached across turns. Saves tokens and latency on every LLM call.

**Point at the `agent.subscribe()` block a few lines below (~line 818):**

> And `subscribe()` is how we get real-time telemetry. Every text delta, every tool call start, every usage report streams through here. That's what powers the live dashboard you saw: the tool call chips, the reasoning stream, the progress bar.

---

### 5:30 — The Model Switch Trick

**Scroll to ~line 462, or show the bookmarked split.**

> This is probably my favorite piece of code in the project.

*On screen — `switchModelInPlace()` at ~line 462. They can see the `Object.assign` call.*

> The dual-model pattern. Sonnet investigates (the expensive, powerful model). Haiku writes the report (fast and cheap).
>
> The problem is that Pi's run loop captures the model object by reference when it starts. If you call `setModel()`, you replace the reference on the agent, but the loop is still holding the old object.
>
> So we mutate the object in place. `Object.assign` overwrites the properties on the same JavaScript object the loop is holding. No abort, no restart, no lost conversation context. The very next LLM call just goes to a different model.

**Scroll to ~line 625 where the switch is triggered.**

*On screen — the `if (toolName === 'switch_to_fast_model')` block with `snipBoundaryActive = true`.*

> The agent decides when to switch. It calls `switch_to_fast_model` as a tool, which is a stub that does nothing. The real switch happens in this hook. And the moment it switches, `snipBoundaryActive` flips to true.

**Scroll to ~line 721, the context compression.**

> That flag activates aggressive context compression. Three tiers for the conversation history. Recent messages: full fidelity. Mid-age: tool results compressed to 600 characters. Old: compressed to 120.
>
> But after the model switch, after investigation is done, those limits drop to 80 and 40. The writing phase doesn't need the raw file contents. It just needs the findings.
>
> That compression plus the cheaper model is what makes a single-goal run cost 74 cents instead of two dollars.

---

### 7:00 — Budget Planner for Multi-Goal Runs

**Show tab: `src/agent/budgetPlanner.ts`. Scroll to `planBudget()` at ~line 69.**

> This powers the all-goals run we kicked off. Before any LLM call, we run a pre-compute phase: four deterministic tools in parallel. Detect app roots, parse package.json, list the directory tree, load specialist prompts. No LLM, just tool execution.
>
> The budget planner takes those signals and decides how to split the budget across passes.

**Point at the conditional blocks.**

> Next.js detected with a UI framework? 60% core, 20% Next.js specialist, 20% accessibility. Backend-only repo, no UI? 100% goes to core, specialists are skipped entirely.

**Scroll to `rebalanceBudget()` at ~line 196.**

> After the core pass finishes, this rebalances based on what was actually found.
>
> Core found no Next.js patterns despite the pre-compute signals? Maybe a false positive, so the Next.js specialist gets skipped and budget goes to accessibility. Core under-utilized its budget? Repo was simpler than expected, specialist budgets shrink by 40%. Core already found 5-plus findings in a specialist's category? That specialist gets less because the ground is already covered.
>
> Pure functions. No LLM, no I/O. Deterministic budget intelligence.

---

### 8:00 — Evidence Verification

**Show tab: `src/tools/analysis/recordFinding.ts`. Scroll to `extractFindings()` at ~line 133.**

> LLMs hallucinate. Especially after long conversations push the original file reads out of context. So every time the agent calls `record_finding`, this code runs.

> First practical problem: the LLM sends findings in six different argument shapes.

**Point at the case handlers:**

> Sometimes it wraps the finding in a `finding` key. Sometimes it sends it flat. Sometimes it double-nests it. Sometimes it batches multiple findings in an array. Sometimes it serializes the array as numbered object keys. This function normalizes all six shapes.

> Then the evidence verification. For every piece of evidence the agent cites: did it actually read that file during this run? Is the code snippet it cited actually in that file on disk?
>
> If the snippet doesn't match (maybe the LLM drifted after 30 turns of conversation), the system auto-corrects to the real code. If the file was never read at all, the evidence is rejected entirely.
>
> After the loop completes, a separate verification pass re-reads every cited file from disk and drops findings where all evidence is unverifiable.
>
> No LLM involved in verification. Pure string matching against the filesystem. The agent cannot hand-wave.

---

### 8:30 — Prompt Injection Defense

**Show tab: `src/agent/contextBoundary.ts`.**

> Quick security note. The agent reads files from repositories we don't control. Someone could put "ignore previous instructions" in a code comment.

**Point at the boundary strings and the injection pattern array.**

> Every tool output gets wrapped in open and close delimiters. The system prompt tells the agent to treat everything inside these markers as data, not instructions.
>
> And we have 11 pattern detectors: "ignore previous instructions," "you are now," "new system prompt," delimiter escape attempts. Suspicious patterns in a finding's content get flagged automatically.
>
> Not bulletproof against sophisticated attacks, but meaningful protection against what you'd actually find in production codebases.

---

### 9:00 — Transition Back

> That's the engine. Four layers, no layer reaches into another. Let me show you what it produces.

**Switch back to the browser.**

---

## 9:00 — ACT 3: THE RESULTS

**Click the completed all-goals run in the sidebar. Multi-goal view loads.**

> I ran this earlier today against the same Sitecore repo. Same agent, same rules. Here are the results.

---

### 9:00 — The Scoreboard

**On screen: Scoreboard row at top — goal cards with letter grades.**

> This is the panoramic view. Every goal type scored with a letter grade. At a glance you can see where this repo is healthy and where it needs attention.

**Point at individual goal cards. Read the grades aloud:**

> Security: [read the grade]. Architecture: [grade]. Accessibility: [grade]. Next.js health: [grade]. Onboarding: [grade]. Each one is a full assessment with its own scorecard and its own findings.

---

### 9:45 — Top Risks

**Point at the Top Risks section below the scoreboard.**

> The agent surfaced the top risks across all goals, ranked by severity. Critical and high at the top. You scan this in five seconds and know exactly where to focus in a client meeting.

---

### 10:00 — Investigation Passes

**Point at the Investigation Passes progress bars.**

> And this is the budget planner I just showed you in code. Core pass got 60% of the budget. Next.js specialist got 20%. Accessibility got 20%. The progress bars show how much each pass actually consumed. You can see the core pass used most of its allocation, the specialists used less. The rebalancer worked.

---

### 10:15 — Drill Into Security

**Click the Security goal section to expand it. Scorecard and findings load.**

> Let's look at what the security assessment found.

**Point at the per-category scorecard grid:**

> Six categories scored. Auth and session management. Secrets and environment. Input validation. Security headers. Dependencies. Data exposure. Red means action needed.

**Scroll to a high-severity finding. Point at each piece:**

> Look at this finding. Severity badge, high. Category, security. File path and line number. And the evidence: the actual code snippet.
>
> That snippet was verified against the real file on disk. If the agent had fabricated that snippet, it would've been caught and either auto-corrected or dropped.

**Click into a second finding:**

> Every finding is like this. File-level evidence, verified. This is what a senior architect starts from. They review the findings, adjust severity based on their judgment, add business context the agent can't know. The agent does the reading. The human does the thinking.

---

### 11:15 — Drill Into Accessibility

**Click the Accessibility goal section to expand it.**

> Different goal, completely different lens on the same codebase. WCAG 2.1 AA compliance. The agent checked ARIA labels, keyboard navigation, color contrast, semantic HTML structure.

**Scroll through one or two findings:**

> Same quality of evidence. File, line, snippet. The accessibility rules encode the same expertise your accessibility specialist would apply, except this ran in about 90 seconds as part of the sweep.

> Same 23 tools. Same agent runtime. Different rules, different output. Security rules look for auth and secrets. Accessibility rules look for ARIA and contrast. One architecture, many deliverables.

---

### 12:00 — Optional: Onboarding Brief

*If time allows and the audience is engaged, expand the Onboarding section:*

> This one's a different shape entirely. Not a scorecard, it's a 12-section developer onboarding brief. Architecture overview, environment setup, data flow, CMS integration patterns, deployment process. Everything a new developer joining this project needs on day one. Same run, same budget, completely different deliverable.

---

## 13:00 — ACT 4: CREATE GITHUB ISSUES

**Navigate to a single-goal completed run (e.g., click the Security run from the sidebar, or navigate from the multi-goal view into a single goal).**

> Reports are great, but findings need to become work. Let me show you what happens next.

---

### 13:00 — Open the Modal

**Click the "Create Issues" button in the export toolbar.**

> Create Issues. This takes the findings from this run and pushes them directly into GitHub as individual issues.

**The modal opens. Point at the owner/repo fields:**

> It auto-detects the repository from the analysis. I'll point it at a test repo for this demo.

**Type your test repo owner/name into the fields.**

---

### 13:30 — Configure the Threshold

**Click the severity threshold dropdown. Show the options.**

> Severity filter. I can choose to only create issues for critical and high findings. Or medium and above. Or all the way down to informational. Let's do medium and above.

**Select "Medium and above." Point at the preview text:**

> [X] issues will be created. [N] high, [M] medium. It tells you exactly what's going to happen before you commit.

> And duplicates get skipped automatically via fingerprint matching. Every finding gets a fingerprint, a SHA-256 of the category, file path, and normalized title.
>
> Run this again next month, and findings that haven't changed won't create duplicate issues. You only see what's new.

---

### 14:00 — Create Them

**Click "Create [X] Issues." Watch the spinner.**

> Creating...

**Issues are created. Results appear with green checkmark and count.**

> Done. [X] issues created.

**Point at the issue links in the results list:**

> Every one is a clickable link to the GitHub Issue. Let me open one.

**Click an issue link. GitHub opens in a new tab.**

> Title. Severity label, high. Category label, security. The file path. The evidence snippet right there in the issue body. And at the bottom, the fingerprint hash for deduplication.
>
> Every finding just became a trackable work item. Your PM can prioritize these. Your developers can pick them up. The agent's investigation just turned into your sprint backlog.

**Switch back to the dashboard tab.**

---

### 15:30 — The Dedup Beat

> That fingerprint (a hash of the category, file path, and title) is how you track drift over time without a database.
>
> Run the assessment again next quarter. Findings that haven't changed: no duplicate issues. New findings: new issues. Resolved findings: you can see what went away. In CI, this comparison happens automatically on every PR.

---

## 16:00 — ACT 5: THE NUMBERS + CLOSE

**Navigate back to the multi-goal view. Point at the stats in the header bar.**

> Let's talk about cost. This entire all-goals sweep (security, architecture, accessibility, onboarding, Next.js, component mapping): [X] tool calls, [Y] seconds, $[Z].
>
> About 7 dollars for the full diagnostic across every goal type.

**Pause. Two seconds of silence. Let the number land.**

> A single-goal run, just security or just accessibility, about 74 cents.

> The dual-model pattern makes this possible. You saw the code. Sonnet runs the investigation, expensive and powerful. When the agent decides it's done, it calls `switch_to_fast_model`. We mutate the model object in place, no restart, no lost context. Haiku writes the report.
>
> And the context compression kicks in. Old tool results go from 600 characters down to 80. That switch saves about 37% on cost.

---

### 17:00 — The Takeaways

**Hold up one finger.**

> It runs anywhere. A client's network, their LLM provider, behind their firewall. Four environment variables. Change from AWS Bedrock to Azure OpenAI. No code changes. No data leaves their environment.

**Hold up two fingers.**

> The rules are yours. Plain English markdown files. A security playbook, an accessibility checklist, an onboarding template. Add one, and every run benefits from it.
>
> That's institutional knowledge that scales. It doesn't walk out the door when someone leaves.

**Hold up three fingers.**

> Findings become work. Reports are table stakes. What matters is the pipeline from finding to issue to sprint to resolution.
>
> You just saw it: findings with evidence go straight into GitHub Issues. In CI, this happens automatically on every PR. Quality doesn't drift because nobody's watching.

---

### 18:00 — The Close

> That's Radar. An AI agent that investigates codebases and produces scored consulting deliverables. Ten goal types, 23 tools, plain English rules, under a dollar per run.

> Happy to dig into anything: the agent runtime, the CI pipeline, the budget planner, whatever you want to see.

---

## BONUS: IF THE LIVE RUN FINISHES

**Check the sidebar during Q&A. If the live all-goals run from Act 1 has completed:**

> The live run we kicked off at the start just finished. Let me pull it up so you can see this wasn't canned.

**Click into it. Show the scoreboard.**

> Same repo, fresh run. Same grades, same findings. The rules drive the investigation, not randomness.

*If findings differ slightly from the replay:*

> A couple differences from the earlier run. The agent explored slightly different paths this time. That's the nature of agentic investigation. The rules constrain what it looks for, but the exact path varies. The findings converge.

---

## Q&A READY RESPONSES

Keep these loaded. The question is in bold, the answer is the blockquote.

---

**"How is this different from SonarQube or Snyk?"**

> Those are pattern matchers. They check syntax rules and known vulnerability databases.
>
> Radar reasons about architecture. It understands that a Sitecore editing integration has three components that need to be wired together, or that a dependency version is incompatible with the Next.js App Router. It reads code the way an experienced engineer would.

---

**"Can it hallucinate findings?"**

> Every finding goes through deterministic evidence verification. The agent must cite files it actually read during the run. Every code snippet is checked against the real file on disk.
>
> Mismatch? It auto-corrects. File never read? Evidence rejected. Findings with no verifiable evidence get dropped before scoring. No LLM involved in verification.

---

**"What if it misses something?"**

> It will. This is an investigator, not a guarantee. The value is the 80% it catches in 8 minutes. The architect reviews the report, adds what's missing, adjusts severity based on their judgment and business context. The agent does the reading. The human does the thinking.

---

**"Can it fix the issues it finds?"**

> Not yet, read-only today. But every finding has file-level evidence: the exact file, line, and code snippet. Extending to auto-fix is a natural next step.
>
> We're deliberate about that boundary. Investigation is high-confidence. Automated code changes need more guardrails.

---

**"How do we add a new CMS or framework?"**

> Write a platform rules file in markdown. Write reference files for the framework's patterns. The agent picks them up on the next run. No changes to the agent, the tools, or the output layer.

---

**"What does it cost per run?"**

> Under a dollar for a single-goal run on Claude Sonnet plus Haiku via Bedrock. The full all-goals sweep is roughly 7 to 8 dollars. Cost scales linearly with the tool call budget. You want a deeper investigation, you increase the budget.

---

**"Can this run in CI?"**

> Yes. Auto-detects GitHub Actions and Azure DevOps from environment variables.
>
> Posts PR comments with the scorecard and a findings diff: new, resolved, persistent. Adds file-level annotations inline in the PR. Uploads SARIF for code scanning. Applies labels. Evaluates a quality gate (exit code 0 for green, 1 for red). You can fail a PR if security findings are critical.

---

**"Is this tied to Sitecore and Optimizely?"**

> No. Those are the platform rules we wrote first because that's our practice. There's a generic audit goal that works on any web framework: React, Vue, Angular, plain Node.js. The CMS-specific goals just layer platform rules on top. The architecture is framework-agnostic.

---

**"Can clients run this themselves?"**

> Yes. That's the point. Clone the repo, set their LLM provider env vars, `pnpm install`, `pnpm dashboard`. It runs in their network, on their infrastructure. No SaaS dependency. No data leaving their environment.

---

**"How long did this take to build?"**

> Started with a 1,200-line spec before any code. Built it in about three weeks. 85 test files, 23 tools, 10 goal types.
>
> The architecture is the leverage. Once the layers are in place, adding a new goal type takes an afternoon, not a sprint.

---

**"What agent framework is this built on?"**

> Pi Agent, an open-source TypeScript agent runtime. Gives us the observe-reason-act loop, parallel tool execution, context management, event streaming.
>
> We added hooks for budget control, model switching, context compression, and prompt caching on top. The tools and rules are framework-agnostic. You could swap Pi for another runtime.

---

**"How does parallel tool execution stay safe?"**

> Two groups. 21 read-only tools run fully parallel. Three stateful tools (record finding, assemble output, switch model) serialize through an async mutex.
>
> The mutex chains promises so each stateful call waits for the previous one. Read-only calls bypass it entirely.

---

**"What happens if the agent doesn't cooperate? Doesn't switch models, doesn't record findings?"**

> Three escalation levels.
>
> At 50% budget, soft steering: "consider switching to the fast model." At 75% with zero findings, hard gate: investigation tools blocked, only `record_finding` allowed. At 5 calls remaining, force model switch, critical message demanding immediate output.
>
> And if the loop ends without the agent producing output, we retry with follow-up nudges on the fast model.

---

**"How does it handle large or complex repos? Monorepos?"**

> Tool call budget, default 45 for a single goal. The agent prioritizes based on the rules, it doesn't try to read every file.
>
> For monorepos, `detect_app_roots` identifies the main workspaces first, then the agent focuses on the most relevant roots. Budget is extensible: extend 50 calls at a time interactively, or set a higher budget up front.

---

**"How does the comparison and trend tracking work without a database?"**

> Every finding gets a fingerprint, a SHA-256 of category, file path, and normalized title. To diff two runs, you compare fingerprint sets. Only in the new run? "New." Only in the old? "Resolved." In both? "Persistent."
>
> In CI, the previous run's JSON is stored as a pipeline artifact and downloaded automatically for comparison. Pure set math, no database.

---

**"What about specialist rules? Does it know about GraphQL, Tailwind, Prisma?"**

> Yes. Specialist rule files load on demand. During the pre-compute phase, we detect which technologies are present (GraphQL schemas, Tailwind configs, Prisma setups) and load the relevant specialist rules into context.
>
> The agent doesn't carry all domain knowledge at once. It loads what's relevant to the repo it's investigating.

---

## FALLBACK PLAYS

**Pre-generated all-goals run is missing or broken:**
Run `Security Review` live against the Sitecore repo. Takes ~2 minutes. Demo the single-goal view. Explain multi-goal verbally: "In the full sweep this runs across all goal types, you get a scoreboard with grades for each one."

**GitHub Issues creation fails (token/network/permissions):**
Show the modal up to the preview. The count and severity breakdown are the demo moment. Say: "In production this creates the issues — I have a permissions issue on the test repo right now, but you can see the preview: 8 issues, 3 high, 5 medium, fingerprint deduplication."

**Code walkthrough runs long:**
Cut 2G (prompt injection) — least essential. If still behind, compress 2E (budget planner) to one sentence: "The budget planner allocates across goals using signals from a pre-compute phase, then rebalances after the first pass based on what it found. Pure functions, no LLM."

**Live run finishes with errors or partial results:**
Don't hide it. Show it. "This one had a partial result — the agent hit a rate limit. But watch: it assembled a report from what it had. Graceful degradation. In CI, partial results still post to the PR with a warning."

**Someone asks to see a file you don't have tabbed:**
"Let me pull that up" — use VS Code's Cmd+P to open by filename. Key files for ad-hoc requests:
- `src/agent/goalPrompts.ts` — how the goal prompt is templated
- `src/tools/concurrency.ts` — the mutex pattern
- `src/agent/retry.ts` — retry logic with per-status limits
- `src/output/scorecard.ts` — how scores are computed
- `src/ci/orchestrator.ts` — CI pipeline integration

---

## TIMING REFERENCE

| Marker | What | Cumulative |
|--------|------|-----------|
| 0:00 | Hook | 0:00 |
| 0:30 | Act 1: Kick off live run | 0:30 |
| 2:00 | Act 2: Architecture diagram | 2:00 |
| 3:00 | Act 2: Rules markdown | 3:00 |
| 3:30 | Act 2: Provider-agnostic config | 3:30 |
| 4:00 | Act 2: Pi Agent wiring | 4:00 |
| 5:30 | Act 2: Model switch trick | 5:30 |
| 7:00 | Act 2: Budget planner | 7:00 |
| 8:00 | Act 2: Evidence verification | 8:00 |
| 8:30 | Act 2: Prompt injection defense | 8:30 |
| 9:00 | Act 3: Scoreboard | 9:00 |
| 9:45 | Act 3: Top risks | 9:45 |
| 10:00 | Act 3: Investigation passes | 10:00 |
| 10:15 | Act 3: Security drill-down | 10:15 |
| 11:15 | Act 3: Accessibility drill-down | 11:15 |
| 12:00 | Act 3: Onboarding (optional) | 12:00 |
| 13:00 | Act 4: Issues modal | 13:00 |
| 14:00 | Act 4: Create issues | 14:00 |
| 15:30 | Act 4: Dedup explanation | 15:30 |
| 16:00 | Act 5: Cost numbers | 16:00 |
| 17:00 | Act 5: Three takeaways | 17:00 |
| 18:00 | Close + Q&A | 18:00 |

**Short version (10 min):** Hook → Act 1 (kick off) → Act 2 cut to only Pi Agent wiring + model switch (3 min) → Act 3 (scoreboard + one drill-down) → Act 5 (numbers + close). Skip Issues.

**Shortest version (7 min):** Hook → skip to replay immediately → Scoreboard + one drill-down → Issues preview only → Numbers + close. No code walkthrough.

**Extended version (25 min):** Full script + comparison view (Sitecore vs Optimizely) + Investigation tab replay of agent reasoning + live editing of a rule file.

---

## CODE WALKTHROUGH REFERENCE CARD

Quick-reference for what to show and where. Use during Act 2 or when fielding follow-up questions.

| # | What to show | File | Line | The point |
|---|-------------|------|------|-----------|
| 1 | A consulting rule | `src/rules/goal-security-review.md` | — | "Rules are plain English. Adding expertise is writing markdown." |
| 2 | Pi Agent wiring | `src/agent/runner.ts` | ~795 | `new Agent({...})` — hooks for budget, steering, compression, caching |
| 3 | Event streaming | `src/agent/runner.ts` | ~818 | `agent.subscribe()` — real-time telemetry → dashboard |
| 4 | Model switch trick | `src/agent/runner.ts` | ~462 | `Object.assign(piModel, {...})` — mutate model mid-loop |
| 5 | Snip boundary | `src/agent/runner.ts` | ~625 | `snipBoundaryActive = true` triggers 80/40 char compression |
| 6 | Context compression | `src/agent/runner.ts` | ~721 | 3-tier compression: 600 → 120 → 80/40 chars post-switch |
| 7 | Budget enforcement | `src/agent/runner.ts` | ~478 | `beforeToolCall` — gates, per-tool quotas, recording mode |
| 8 | Steering messages | `src/agent/runner.ts` | ~680 | `agent.steer()` at 50% budget: "switch now" |
| 9 | Provider-agnostic | `src/config/piModel.ts` | all | Two models from env vars, no provider names in code |
| 10 | Budget planner | `src/agent/budgetPlanner.ts` | ~69 | Signal matrix → allocation for multi-goal runs |
| 11 | Post-core rebalance | `src/agent/budgetPlanner.ts` | ~196 | Adjust specialist budgets based on core findings |
| 12 | Pre-compute layer | `src/agent/runner.ts` | ~196 | 4 tools in parallel before the loop, saves 3-5 LLM turns |
| 13 | Finding extraction | `src/tools/analysis/recordFinding.ts` | ~133 | Handles 6 LLM argument shapes — resilient to format drift |
| 14 | Evidence verification | `src/tools/analysis/recordFinding.ts` | ~289 | Snippet vs. actual file content, auto-correct or reject |
| 15 | Prompt injection | `src/agent/contextBoundary.ts` | all | Boundary delimiters + 11 injection pattern detectors |
| 16 | Concurrency | `src/tools/concurrency.ts` | all | Read-only parallel + mutex for stateful tools |
| 17 | Secret redaction | `src/agent/redaction.ts` | all | API keys, PEM blocks, connection strings redacted |
| 18 | System prompt assembly | `src/agent/systemPrompt.ts` | all | `core.md + platform-*.md + goal-*.md` composed at runtime |
| 19 | Prompt caching | `src/agent/runner.ts` | ~777 | `cache_control: { type: 'ephemeral' }` injection |
| 20 | Retry logic | `src/agent/retry.ts` | all | Per-status retry limits, exponential backoff + jitter |

---

## DEEP DIVE TOPICS (for extended Q&A)

**"How does the agent decide what to investigate?"**
Show: `src/agent/goalPrompts.ts` — the goal prompt template includes budget allocation guidance (60% investigate, 25% record, 15% assemble) and a confidence calibration scale.

**"How does prompt caching work?"**
Show: `src/agent/runner.ts:~777` — `onPayload` hook injects `cache_control` breakpoints into the system prompt. Portkey forwards these to Bedrock's Anthropic API. The system prompt + tool definitions are cached across turns.

**"How does parallel tool execution stay safe?"**
Show: `src/tools/concurrency.ts` — 21 read-only tools run fully parallel. 3 stateful tools (`record_finding`, `assemble_output`, `switch_to_fast_model`) serialize through an async mutex. The mutex chains promises so each stateful call waits for the previous one, but read-only calls bypass it entirely.

**"What happens when the agent doesn't cooperate?"**
Show: `src/agent/runner.ts:~495` (recording gate) and `~680` (steering). Three escalation levels:
1. At 50% budget: `agent.steer()` with a soft reminder
2. At 75% budget with 0 findings: `beforeToolCall` blocks everything except `record_finding`
3. At 5 calls remaining: force model switch + CRITICAL message
Post-loop: if `assemble_output` was never called, retry with `agent.followUp()` nudges.

---

## EXTENDED SCENE: COMPARISON VIEW

*Use this if you have 20+ minutes or during Q&A when someone asks about drift tracking. Requires two completed runs — either the same repo at different times, or Sitecore vs Optimizely.*

**Navigate to the comparison view (click "Compare" or navigate to `/compare/{id-a}/{id-b}`).**

> This is how you track drift over time. Two runs, side by side.

**Point at the scorecard comparison:**

> Scorecard deltas. Green means one repo improved in that category. Red means it regressed. You can see at a glance which areas got better and which got worse between runs.

**Scroll to the findings diff:**

> Three sections. New findings: issues that appeared since the last run. Resolved: issues that went away. Persistent: still there.

> Every finding has a fingerprint, a hash of its category, file path, and title. That's what makes this comparison work. No database. Just set intersection on two JSON files. Run this on the same repo every sprint, and you have automated drift tracking.

> In CI, the previous run's JSON is stored as a pipeline artifact. The next run downloads it and diffs automatically. The PR comment shows what changed: new risks in red, resolved in green.

---

## EXTENDED SCENE: SIDEBAR HISTORY + EVENTS TAB

*Quick scene to show run persistence and the audit trail. 30 seconds.*

**Point at the sidebar run history.**

> Every run is saved and replayable. Click any historical run to see its full results, or replay the event stream to see exactly what the agent did.

**Click the Events tab on a completed run.**

> This is the audit trail. Every tool call, every reasoning step, every finding recorded, in order. If a client asks "why did it flag this file?" you can trace the agent's reasoning step by step.

---

## EXTENDED SCENE: INVESTIGATION VIEW PANEL GUIDE

*Reference for describing what's on screen during a live run or replay via the Investigation tab.*

**Left panel — Agent reasoning stream:**
- Real-time streaming text: the agent's reasoning as it thinks
- Colored tool call chips below each reasoning block: `read_file` (blue), `grep_pattern` (purple), `analyze_route_structure` (teal), etc.
- Phase indicator at top: **Analyzing → Switching → Recording → Assembling → Complete**
- Progress bar: fills as the tool call budget is consumed
- Elapsed time counter in the corner

**Right panel — Live findings + file tree:**
- **Files Examined** — grows as the agent reads files (shows it building a mental model)
- **Findings** — populates in real time with severity badges (critical/high/medium/low)
- **Stats panel** — live file count, finding count, severity breakdown

**What to call out during a live run:**

> Watch the tool calls. Started with package.json, identified the stack, now it's deciding where to dig. No hardcoded sequence.

*When a finding appears:*

> First finding just landed. File path, line number, code snippet. That evidence is pulled from the file it read, not generated.

*When `switch_to_fast_model` appears:*

> `switch_to_fast_model`. The agent decided it's done investigating. Switching to the cheaper model for the writing phase. That saves 37% on cost.

*If the budget pause modal appears:*

> Budget exhaustion. You can extend (add 50 more calls) or tell it to finish with what it has. In CI, it auto-finishes. In the dashboard, you get the choice.

---

## APPENDIX A: THE 23 TOOLS

*Full catalog for reference when someone asks "what can it do?" or "what tools does it have?"*

### Repo Access

| Tool | What it does |
|------|-------------|
| `list_directory` | List files and directories, detect binary files |
| `read_file` | Read a file with caching and path suggestions on error |
| `read_files_batch` | Read multiple files in parallel |

### Search

| Tool | What it does |
|------|-------------|
| `grep_pattern` | Regex search across files (ripgrep with Node.js fallback) |
| `find_files` | Find files by glob pattern |

### Config Parsing

| Tool | What it does |
|------|-------------|
| `parse_package_json` | Extract dependencies, scripts, workspaces |
| `parse_next_config` | Parse Next.js configuration |
| `parse_tsconfig` | Extract TypeScript settings and path aliases |
| `parse_env_file` | Parse .env files (values redacted) |
| `check_gitignore` | Check if patterns are gitignored |

### Dependencies

| Tool | What it does |
|------|-------------|
| `query_npm_versions` | Fetch latest npm versions (cached 24h) |
| `compare_versions` | Compare installed vs latest, classify semver drift |

### Code Analysis

| Tool | What it does |
|------|-------------|
| `analyze_route_structure` | Map Next.js app/pages routes, detect router type |
| `analyze_component_directives` | Scan for `'use client'` / `'use server'` boundaries |
| `analyze_env_usage` | Find environment variable references across the codebase |
| `analyze_middleware` | Parse middleware.ts for auth and site resolver patterns |
| `detect_app_roots` | Identify app roots in monorepos |
| `detect_scope_drift` | Check monorepo package boundaries |

### Findings

| Tool | What it does |
|------|-------------|
| `record_finding` | Record a finding with evidence, severity, confidence, and fingerprint |
| `verify_evidence` | Verify finding evidence against actual file content |
| `get_specialist_prompts` | Load specialist rules for specific domains (GraphQL, Tailwind, etc.) |

### Web

| Tool | What it does |
|------|-------------|
| `web_search` | Search approved documentation sources |
| `fetch_url` | Fetch a URL and convert HTML to markdown |

### Agent Control

| Tool | What it does |
|------|-------------|
| `switch_to_fast_model` | Signal investigation is done, switch to cheaper model |
| `assemble_output` | Write structured sections for the final deliverable |

---

## APPENDIX B: THE RULES

*Detailed breakdown for when someone asks "what rules does it follow?" or "how do you encode expertise?"*

### Core Rules (`src/rules/core.md`) — loaded every run

- Where to start (always read package.json first)
- Investigation priorities (preview/editing mode is #1 escalation source for CMS)
- Finding standards (minimum 8 findings, every category needs at least one)
- Evidence integrity (you can only cite files you've actually read)
- Confidence calibration (1-10 scale: 9-10 verified, 7-8 pattern, 5-6 likely, 3-4 speculative)

### Goal Rules — one per assessment type

| File | What it defines |
|------|----------------|
| `goal-audit.md` | Architecture assessment with weighted scoring (type check 25%, lint 20%, tests 30%, dead code 15%, shell lint 10%) |
| `goal-security-review.md` | 6-category security audit with 22 false-positive exclusion rules and 16 pattern types |
| `goal-onboarding.md` | 12-section developer onboarding brief (30-min read target) |
| `goal-nextjs.md` | 7-category Next.js framework health check |
| `goal-accessibility.md` | 6-category WCAG 2.1 AA compliance review |
| `goal-migration.md` | Migration hotspots + complexity assessment |
| `goal-ci-check.md` | Fast CI health check (15 tool calls max, 3 categories) |
| `goal-component-map.md` | Component registration pattern inventory |
| `goal-audit-generic.md` | Generic audit for any web framework (7 categories) |
| `goal-universal.md` | Core shared investigation rules used by all goals |

### Platform Rules — one per CMS

| File | What it adds |
|------|-------------|
| `platform-sitecore.md` | Sitecore XM Cloud / JSS patterns, editing integration, GraphQL schema |
| `platform-optimizely.md` | Optimizely SaaS CMS patterns, content delivery, visual builder |

### Specialist Rules (`src/rules/specialists/`) — loaded on demand

Loaded when `get_specialist_prompts` detects specific technologies in the app roots:

- `graphql.md` — GraphQL schema, resolvers, N+1 queries
- `tailwind.md` — Tailwind config, purge, custom theme
- `prisma.md` — Prisma schema, migrations, client usage
- `nextjs.md` — Next.js-specific deep patterns
- `cms-sitecore.md` — Sitecore-specific deep patterns
- `cms-optimizely.md` — Optimizely-specific deep patterns

---

## APPENDIX C: CI/CD INTEGRATION DETAIL

*Full orchestrator breakdown for when someone asks "what exactly does it do in CI?"*

The CI orchestrator (`src/ci/orchestrator.ts`) runs 9 steps post-analysis:

1. **Download previous run artifacts** — for trend tracking (previous JSON stored as pipeline artifact)
2. **Diff findings by fingerprint** — new / resolved / persistent via SHA-256 set intersection
3. **Post PR comment** — scorecard + finding diff with severity badges
4. **Add file-level annotations** — findings appear inline in the PR diff
5. **Upload SARIF** — for GitHub's code scanning tab / Azure DevOps equivalent
6. **Apply labels** — `radar:security-risk`, `radar:clean`, `radar:needs-review`, etc.
7. **Upload run artifacts** — JSON export stored for next-run comparison
8. **Fire webhooks** — Slack/Teams notifications with scorecard summary
9. **Evaluate quality gate** — exit code 0 (green/yellow) or 1 (red); can fail the PR

Platform auto-detection:

| Platform | Adapter | Detection |
|----------|---------|-----------|
| GitHub Actions | `src/ci/github.ts` | `GITHUB_ACTIONS` env var |
| Azure DevOps | `src/ci/azureDevops.ts` | `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` env var |
| Generic (fallback) | `src/ci/adapter.ts` | Always available |

---

## APPENDIX D: TEST COVERAGE

*For when someone asks "how tested is this?" or to demonstrate engineering rigor.*

**85 test files, 219+ tests across 6 categories:**

| Category | Files | Coverage |
|----------|-------|----------|
| **Tool tests** | 34 | Every tool: happy path + error cases |
| **Output tests** | 11 | Brief, scorecard, JSON, SARIF, CI comment, PDF export |
| **CI tests** | 9 | Platform adapters, orchestration, quality gates, webhooks, fingerprinting |
| **Agent tests** | 6 | System prompt, retry logic, step events, budget planner, goal prompts |
| **Security tests** | 2 | Prompt injection defense, secret redaction |
| **E2E tests** | 3 | Full agent loop with stubbed tools (accessibility, Next.js, all-goals) |
| **Dashboard tests** | 7 | Session management, API routes, URL state, run transforms, backward compat |

Test fixture: `test/fixtures/sitecore-minimal/` — a minimal Sitecore XM Cloud project.
