# Radar: 30-Minute Internal Demo Script

Second-monitor guide. Glance at section headers and bullets. Don't read verbatim.

---

## PRE-FLIGHT (30 min before)

- [ ] Pre-generated `goal=all` run visible in sidebar (fresh, regenerate if >24h old)
- [ ] A second pre-generated single-goal run (security-review) for comparison
- [ ] `pnpm dashboard` running, browser at `localhost:3000`, light mode
- [ ] VS Code tabs open:
  1. `src/rules/goal-security-review.md`
  2. `src/config/piModel.ts` (78 lines total)
  3. `src/agent/runner.ts` (~line 290 Agent constructor, ~line 178 pre-compute)
  4. `src/agent/agentLoopContext.ts` (~line 150 switchModelInPlace, ~line 412 switch trigger, ~line 464 steering)
  5. `src/agent/budgetPlanner.ts` (~line 147 planBudget, ~line 274 rebalanceBudget)
  6. `src/tools/analysis/recordFinding.ts` (~line 152 extractFindings, ~line 349 evidence verification)
  7. `src/tools/analysis/verifyEvidence.ts` (~line 75 snippetMatchesContent, ~line 169 verifyAndCorrectEvidence)
  8. `src/agent/contextBoundary.ts` (~line 38 injection patterns)
- [ ] GitHub test repo ready (private, you have push access)
- [ ] Sitecore repo URL in clipboard: `https://github.com/Sitecore/xmcloud-starter-js`
- [ ] Second repo URL ready for comparison: `https://github.com/remkoj/optimizely-saas-starter`
- [ ] Terminal open with `radar` alias working (for CLI flash if needed)

---

## THE ARC

| Time | What | Audience feeling |
|------|------|-----------------|
| 0:00 | The Hook | "What is this?" |
| 1:00 | Kick off + flash the live view | "It's alive, I can see it thinking" |
| 4:00 | Pre-generated results deep-dive | "Those are real findings" |
| 8:00 | Outputs: PDF + GitHub Issues + CI | "It goes all the way to delivery" |
| 12:00 | The numbers | "Under a dollar?" |
| 13:00 | Code: Project layout (30 sec) | "Clean separation" |
| 13:30 | Code: Dual-model architecture | "That's clever" |
| 16:00 | Code: Evidence verification | "It can't hallucinate" |
| 19:00 | Code: Budget enforcement | "It can't fail silently" |
| 21:30 | Code: Defensive parsing + rules | "This is production" |
| 24:00 | Big picture / harness thesis | "This is a discipline" |
| 26:00 | Q&A | You have answers ready |

---

## 0:00, THE HOOK (1 min)

> So I built a thing. Radar is an AI agent that does the first week of a consulting engagement in about eight minutes. You point it at a repo and it reads the code, traces the architecture, catalogs the risks, writes it up. Security reviews, architecture audits, accessibility checks, onboarding briefs.
>
> Ten assessment types. 23 tools. Under a dollar per run.

**Open the dashboard.**

---

## 1:00, KICK OFF + FLASH THE LIVE VIEW (3 min)

### The Idle View (20 sec, don't linger)

**Screen: Dashboard idle state.**

- Quick sweep: "Portfolio metrics, cached repos, run history. This is home base."

### Kick Off (1 min)

**Paste Sitecore URL. Click "Pull Repo."**

- Wait for clone success banner.
- Point at detected app roots: "Auto-detects the framework, monorepo structure."

**Click goal dropdown. Hold open 3 seconds.**

> Ten goal types. Security, architecture, accessibility, onboarding, Next.js health, performance, migration, CI check, component map. "All Goals" chains them together.

**Select "Security Review." Show budget presets briefly. Click Start.**

### The Live View (15-20 sec, rapid-fire callouts, then cut away)

**Let the investigation view stream. Point fast:**

- "Reasoning stream on the left, watch it decide what to read."
- "Tool call chips, color-coded. Blue is file reads, purple is grep."
- "Progress bar, budget being consumed in real time."
- "Findings will pop in on the right as it discovers them."
- "Phase indicator at top: Analyzing. It'll switch to Recording when investigation is done, that's a model switch I'll explain later."

> Full transparency into what the agent is doing and why. Not a loading spinner. We'll come back to this if it finishes.
>
> Let me show you a completed run.

---

## 4:00, PRE-GENERATED RESULTS (4 min)

**Click the pre-generated all-goals run in sidebar.**

### Executive Summary + Scoreboard (1 min)

- Point at executive summary banner: letter grade, verdict, stats (findings, tool calls, cost, duration)
- Point at scoreboard cards: Security, Architecture, Accessibility, Next.js, Onboarding
- "One glance. The practice lead knows where to focus."

### Top Risks + Pass Breakdown (45 sec)

- Point at Top Risks section: "Critical and high findings across all goals, ranked. Five seconds to know where to start."
- Point at Pass Breakdown bars (if visible): "This is the budget planner I'll show you in code. Core pass got 60%, specialists got the rest. Those bars show actual budget consumed vs. allocated."

### Drill Into Security (1 min)

- Click Security card → scorecard grid (6 categories: auth, secrets, injection, headers, deps, data exposure)
- Open one high-severity finding
- Point at: severity badge, confidence score, category, file path + line number, the code snippet

> That code snippet was verified against the real file on disk. There's a three-gate verification engine that checks every piece of evidence. I'll walk you through it in a few minutes.

- Point at confidence score: "That number isn't vibes. 9-10 means the agent verified it. 5-6 means it's likely but speculative. Below 3, it gets excluded from scoring."

### Drill Into Onboarding (1 min)

- Click Onboarding card (or scroll to it)
- "Completely different deliverable. Not a scorecard, a 12-section developer onboarding brief. Architecture overview, environment setup, data flow, deployment. Everything a new team member needs on day one. Same run, same budget, different rules."

### If the live run finishes here (likely ~2 min after start)

> The live run just finished. Let me pull it up, this wasn't canned.

- Click it in sidebar. Show results match the pre-generated run.
- "Same repo, fresh run, same findings. The rules drive it, not randomness."
- Then continue to Outputs.

---

## 8:00, OUTPUTS: PDF + ISSUES + CI (4 min)

### PDF Export (45 sec)

**Click "Export PDF" button. Wait for download.**

- Open the PDF (or show the download)
- "Cover page, executive summary, scorecard table, findings detail with evidence. Client-ready. Share with a practice lead or attach to a SOW."

### GitHub Issues (1.5 min)

**Click "Create Issues" button.**

- Point at auto-detected repo. Type test repo name.
- Set severity threshold to "Medium and above"
- Point at preview: "[X] issues will be created. [N] high, [M] medium."

> Every finding gets a fingerprint, SHA-256 of category, file path, and title. Run this again next month. Findings that haven't changed: no duplicate issues. Only new findings create new issues. That same fingerprint powers the CI trend tracking I'll show you in a second.

- Click Create. Wait for green checkmarks.
- Click one issue link → GitHub opens.
- "Title. Severity label. Category label. Evidence snippet. Fingerprint hash. Every finding is now a trackable work item in your backlog."

### CI Pipeline Story (1 min)

> In CI, all of this happens automatically.

Describe verbally (no live demo needed, just point at the concept):

> `radar analyze --repo . --goal ci-check --json` in your GitHub Action or Azure Pipeline. Nine things happen automatically:
>
> 1. PR comment with scorecard and findings diff (new, resolved, persistent)
> 2. Inline file annotations, findings appear in the PR diff
> 3. SARIF upload for GitHub Code Scanning
> 4. Labels applied: `radar:security-risk`, `radar:clean`
> 5. Quality gate: exit code 1 if critical findings → blocks the merge
> 6. Trend tracking: compares against previous run artifact
>
> You can fail a PR if the agent finds a critical security issue. Same engine, different context.

---

## 12:00, THE NUMBERS (1 min)

**Back to multi-goal view. Point at stats in header.**

- Full all-goals sweep: ~$7, ~8 minutes
- Single-goal: ~$0.74 average ($1.38 across validation gauntlet)
- 15 validation runs, 5 real repos, 100% crash-free
- Zero unverifiable evidence across 185 citations
- 219 tests, 85 test files

> That's production economics, not a hackathon prototype.

**Pause 2 seconds.**

---

## 13:00, CODE: PROJECT LAYOUT (30 sec)

**Collapse VS Code sidebar to show `src/` tree. Point at folder names.**

> Before I open files, quick orientation. The architecture is four layers, each does one job.

- `agent/` decides what to do. Orchestration, budget, compression, retry.
- `tools/` does the work. 23 deterministic functions grouped by domain. They never call an LLM.
- `rules/` says what matters. Plain English markdown. Consulting expertise in files.
- `output/` formats the result. Brief, scorecard, PDF, CI comment.

> No layer reaches into another layer's internals. That separation is what makes it testable, swappable, and cheap to extend.
>
> The agent runtime is Pi Agent, open-source TypeScript framework. Same framework OpenClaw is built on. So everything I show you here, the tool-calling loop, the event streaming, the model abstraction, that's transferable. Budget control, context compression, evidence verification, those are our additions on top.

---

## 13:30, CODE: DUAL-MODEL ARCHITECTURE (3 min)

**Show: `src/config/piModel.ts` (whole file, ~77 lines)**

> Two models. The code never says "Sonnet" or "Haiku." Role-based names from environment variables.

- Investigation model: powerful, expensive. Makes the decisions.
- Writing model: fast, cheap. Fills in the report.
- "Change two env vars, you're on a different provider. AWS Bedrock to Azure OpenAI. No code changes. That's how a client runs this on their own infrastructure."

**Show: `src/agent/agentLoopContext.ts` ~line 412 (the switch trigger)**

```
if (toolName === 'switch_to_fast_model' && !modelSwitched) {
```

> Remember the phase indicator on the live view? "Analyzing" to "Recording." This line is what triggers that transition. The agent calls `switch_to_fast_model` as a tool when it decides investigation is done.

**Why let the agent decide?**

> Some repos need 15 investigation turns, others need 35. A timer would waste budget on simple repos and cut short on complex ones. The agent knows when it's done better than any external signal.

**The fallback chain (show `agentLoopContext.ts` ~line 464 steering area):**

> But LLMs forget instructions. So there are three fallbacks:
>
> - At 50% budget, a soft reminder: "you should probably switch now."
> - At 5 calls remaining, force-switch regardless.
> - Post-loop retries always use the fast model.
>
> The agent gets agency. The system guarantees the outcome.

**Context compression tightens at switch:**

> The moment it switches, context compression goes aggressive. Mid-age tool results drop from 600 characters down to 300. The writing model doesn't need the raw file contents anymore, it needs findings context. Tighter compression means cheaper tokens and fewer hallucinations.

---

## 16:00, CODE: EVIDENCE VERIFICATION (3 min)

**Show: `src/tools/analysis/verifyEvidence.ts` ~line 75 (`snippetMatchesContent`) then ~line 169 (`verifyAndCorrectEvidence`)**

> Remember that code snippet in the security finding? I said it was verified against the real file. This is the code that does that. The common approach to hallucination is a system prompt that says "be accurate." That doesn't work. Deterministic verification does.

**Three gates:**

**Gate 1, File-read membership:**
- Every `read_file` call goes into a set
- If the agent cites a file it never opened → rejected outright
- "The agent cannot cite a file it never read. Period."

**Gate 2, Snippet vs. disk:**
- Re-read the actual file. Compare claimed snippet to real content.
- Normalized: strips whitespace, collapses indentation
- 60% of lines must match in order
- Identifier guard: `UPPER_SNAKE_CASE` names in unmatched lines must exist in the file
- "Catches hallucinated env var names that slip through because boilerplate matched."

**Gate 3, Auto-correction:**
- Close but not exact? (LLM paraphrased, truncated, or drifted after context compression)
- Replace with real code at the cited line
- Finding survives with actual evidence

> No second LLM call. Pure string matching against the filesystem.
>
> An agentic system has an advantage here: it knows what the agent actually did. Every file read is tracked. So hallucination detection becomes a set membership test plus a string comparison. That's why this works and "please be accurate" doesn't.

---

## 19:00, CODE: BUDGET ENFORCEMENT (2.5 min)

**Show: `src/agent/agentLoopContext.ts` ~line 164 (beforeToolCall) and ~line 317 (afterToolCall)**

> Remember the progress bar in the live view? That's budget being consumed. The default approach with agents is just letting them run until they're done. In production, that's how you spend $50 and get nothing back.

**The failure mode:**

> I watched the agent burn 60 calls reading files without recording a single finding. Budget exhausted, zero output. That motivated this:

| Budget used | Findings | Response |
|-------------|----------|----------|
| 40% | 0 | Nudge: "start recording" |
| 50% | any | Nudge: "switch models" |
| 60% | 0 | **HARD GATE**, investigation tools blocked |
| 5 calls left | any | Force model switch + CRITICAL |

> The 60% gate is the key. If the agent has spent 60% of budget with nothing to show for it, investigation tools are locked. Only `record_finding` works. That failure mode is architecturally impossible now.

**Budget extension (briefly):**

> In the dashboard, the agent pauses. "Extend" or "Finish." In CI, auto-finishes. Same system, different context. Human-in-the-loop when you want it, autonomous when you don't.

**Multi-goal budget planner (one sentence):**

> Remember the pass breakdown bars on the scoreboard? This is what produces those. `planBudget()` splits budget across passes using pre-computed signals, then `rebalanceBudget()` adjusts after the core pass based on what was actually found. Pure functions. No LLM. Deterministic budget intelligence.

---

## 21:30, CODE: DEFENSIVE PARSING + RULES (2.5 min)

### The 6 Shapes Problem (1 min)

**Show: `src/tools/analysis/recordFinding.ts` ~line 152 (extractFindings)**

> LLMs don't follow schemas reliably. I've seen six different argument shapes for what should be `{ finding: {...} }`:

1. Correct
2. Flat (no wrapper)
3. Double-nested
4. Array of findings
5. Top-level array
6. Array-as-numbered-object-keys

> Anthropic doesn't have strict mode like OpenAI. A retry costs 2 tool calls, 4% of budget gone on format corrections. So I handle all six shapes with zero retries. The LLM sends whatever it wants. We normalize.

### Rules Are Markdown (1 min)

**Show: `src/rules/goal-security-review.md`, scroll slowly**

> This is a goal rule file. Plain English. Categories, severity criteria, patterns to look for, what counts as evidence, false positive exclusions.
>
> Want a new assessment type? Performance? GraphQL security? GDPR compliance? Write one of these files. No code changes. Agent picks it up next run.
>
> The expertise lives in the rules, not the codebase. That's institutional knowledge that scales. It doesn't walk out the door when someone leaves.

### Prompt Injection Defense (30 sec)

**Show: `src/agent/contextBoundary.ts` ~line 38 (injection patterns array), quickly**

> Quick security note. The agent reads files from repos we don't control. Someone could put "ignore previous instructions" in a code comment. Every tool output gets wrapped in boundary delimiters. 11 injection pattern detectors. Suspicious content gets flagged and sanitized before the agent sees it.

---

## 24:00, THE BIG PICTURE (2 min)

### The Four Layers

> Four layers, clean separation:
>
> 1. **Rules**, plain English markdown. The consulting expertise.
> 2. **Agent runtime**, observe-reason-act loop. The intelligence.
> 3. **23 deterministic tools**, read files, parse configs, search code. The facts.
> 4. **Structured output**, scorecards, PDFs, GitHub Issues, SARIF. The deliverable.
>
> No layer reaches into another. Tools don't know about rules. Rules don't know about output. The agent sits in the middle and connects them.

### The Harness Thesis

> Every team has access to the same Sonnet and Haiku. The model is a commodity. The differentiation is everything around it: context compression, budget enforcement, evidence verification, model orchestration.
>
> Stanford published a paper in March calling this "harness engineering." Chelsea Finn's lab at Stanford, the IRIS group. They built a framework that searches over harness parameters automatically. Their finding: harness changes move accuracy independently of model improvements.
>
> The harness is the product. The model is the engine.
>
> Radar's 23 tools, any team could build those. The markdown rules, any consultant could write those. The value is the harness that makes them work together reliably at 74 cents per run.

### The Close

> So where does this go from here? Right now it runs on Sitecore, Optimizely, and any generic web framework. Adding a new platform or assessment type is an afternoon of writing markdown. The CI pipeline means quality doesn't drift because nobody's watching. And every run costs less than a dollar.
>
> Happy to dig into anything: the agent runtime, the CI pipeline, the budget planner, whatever you want to see.

---

## Q&A READY ANSWERS

**"How is this different from SonarQube / Snyk?"**
Pattern matchers. They check syntax rules and known CVEs. Radar reasons about architecture, understands that three components need to be wired together, or that a dep is incompatible with the App Router. Reads code like an engineer, not a regex.

**"Can it hallucinate?"**
Deterministic verification. File-read gate, snippet match against disk, auto-correct or reject. No LLM in the loop. Zero unverifiable evidence across 185 citations.

**"What if it misses something?"**
It will. 80% in 8 minutes. The architect reviews, adjusts severity, adds business context. Agent reads, human thinks.

**"Can it fix the issues it finds?"**
Read-only today. Every finding has file-level evidence, auto-fix is the natural next step.

**"How do we add a new assessment type?"**
Write a markdown rule file. Zero code changes.

**"What does it cost?"**
~$0.74 single-goal. ~$7 all-goals. Scales linearly with tool budget.

**"Can this run in CI?"**
Yes. GitHub Actions + Azure DevOps. PR comments, annotations, SARIF, labels, quality gates, trend tracking. Fails PRs on critical findings.

**"Is this tied to Sitecore?"**
No. Generic audit works on any framework. Validated on React, Next.js, Vue, plain Node.

**"Can clients run this themselves?"**
Clone, set env vars, `pnpm install`, `pnpm dashboard`. Their network, their LLM provider, no data leaves.

**"How long did this take?"**
Three weeks with Claude Code. New goal type takes an afternoon.

**"What agent framework?"**
Pi Agent (open-source TypeScript). Budget control, model switching, context compression, prompt caching are our additions. Tools/rules are framework-agnostic.

**"What about parallel execution?"**
21 read-only tools fire in parallel. 3 stateful tools serialize through a mutex. Plus comparison mode runs two repos simultaneously.

**"How does it handle monorepos?"**
`detect_app_roots` finds workspaces. Agent prioritizes by framework relevance. Budget doesn't scale with repo size, the agent triages.

**"When do findings get recorded? All at the end?"**
No, interleaved. The agent records each finding immediately after investigating that category, 2-4 tool calls then record. The goal prompt explicitly forbids batching because context compression evicts the raw file contents you just read. Record while it's fresh. Then after the loop ends, a second verification pass re-reads every cited file from disk and drops findings where all evidence is unverifiable. Two phases: record early to preserve context, verify late to catch drift.

---

## FALLBACK PLAYS

**Live run doesn't finish:**
"Still running, takes about 2 minutes for single-goal. Everything I'm showing is a completed run." Switch to pre-generated results. Come back at end if it finishes.

**Live run finishes during code walkthrough:**
Pause briefly: "The live run just finished. Let me pull it up so you can see this isn't canned." Click, show it matches pre-generated results. "Same repo, fresh run, consistent results."

**Pre-generated run missing:**
Run Security Review live (~2 min). Demo single-goal view. Explain multi-goal verbally.

**GitHub Issues fails:**
Show modal up to preview. "Permissions issue right now, but you see: 8 issues, severity filter, fingerprint dedup."

**PDF export fails:**
"PDF renderer needs a specific setup, here's what it produces." Show a pre-generated PDF if available.

**Running long on code walkthrough:**
Cut order: (1) defensive parsing, (2) prompt injection, (3) budget planner detail. Never cut dual-model or evidence verification.

**Someone asks to see a file:**
Ctrl+P in VS Code. Key ad-hoc files:
- `src/agent/goalPrompts.ts`, goal prompt template
- `src/tools/concurrency.ts`, mutex pattern
- `src/agent/retry.ts`, retry with per-error tiers
- `src/output/scorecard.ts`, scoring computation
- `src/ci/orchestrator.ts`, 9-step CI pipeline
- `src/ci/github.ts`, GitHub adapter

---

## TIMING CHECKPOINTS

| Clock | You should be at | If behind |
|-------|-----------------|-----------|
| 4:00 | Pre-generated results | You're on pace |
| 8:00 | Starting outputs (PDF/Issues/CI) | Skip onboarding drill-down |
| 12:00 | The numbers | Cut PDF, show Issues only |
| 13:00 | Starting code walkthrough | You have 13 min, on pace |
| 21:30 | Defensive parsing + rules | Cut prompt injection |
| 24:00 | Big picture | You're fine |
| 26:00 | Q&A | Wrap close in 30 sec if needed |

**Rule: if 3+ min behind at any checkpoint, skip to the next section.**

---

## PRESENTATION CRAFT

### Emotional Beats (pause and let it land)

1. **Tool calls flying in live view**, don't talk over it. Let them watch for 10 seconds.
2. **"That snippet was verified against the real file"**, pause after. Let them process.
3. **Cost number ($0.74)**, 2 seconds of silence after saying it.
4. **"I watched it burn 60 calls and produce nothing"**, personal story. Makes the budget system real.
5. **GitHub issue opening**, the moment it goes from "report" to "work item." Don't rush.
6. **"The harness is the product"**, the thesis line. Say it once, clearly, then stop.

### Thread a Single Finding (narrative glue)

Pick ONE high-severity security finding from the pre-generated run and follow it through the whole demo:

- **Results section**: "Look at this finding, hardcoded API key pattern in config.ts, line 42."
- **GitHub Issues**: "There it is as an issue. Same title, same evidence."
- **Evidence verification**: "This is the code that verified that snippet was real."
- **Budget enforcement**: "This is what forced the agent to actually record it instead of reading more files."

One concrete example threaded through > five abstract explanations.

### Voice & Pacing

- **First 4 minutes**: Move fast. Energy. You're showing, not explaining.
- **Code walkthrough**: Slow down. One concept at a time. Let them read the screen.
- **Transitions**: Don't say "next I'll show you." Just show it.
- **Numbers**: Say them once. Don't qualify. Let the audience do the math.
- **Q&A**: Short answers. If they want more, they'll ask a follow-up.

### Body Language

- Point at the screen with your whole hand, not a finger.
- When showing code, step back and let them read for 3-5 seconds before explaining.
- During emotional beats, face the audience, not the screen.

---

## EXTENDED SCENE: COMPARISON VIEW

*Use during Q&A when someone asks about drift tracking. Requires two completed runs.*

**Navigate to comparison view (`/compare/{id-a}/{id-b}`).**

> This is how you track drift over time. Two runs, side by side.

- Point at scorecard comparison: "Deltas. Green improved, red regressed."
- Scroll to findings diff: "Three sections: New, Resolved, Persistent."
- "No database. Fingerprint set intersection on two JSON files. Run every sprint = automated drift tracking."
- "In CI, the previous run is stored as a pipeline artifact. Next run downloads it and diffs automatically."

---

## EXTENDED SCENE: INVESTIGATION REPLAY

*Use if someone asks "can I see what the agent was thinking?" or to kill time if live run hasn't finished.*

**Click the Investigation tab on a completed run.**

- "Full audit trail. Every tool call, every reasoning step, in order."
- Point at a reasoning block → tool calls below it → next reasoning block
- "If a client asks 'why did it flag this file?', trace the reasoning step by step."
- "This is also what streams live in the investigation view."

---

## EXTENDED SCENE: LIVE EDITING A RULE

*Use if someone asks "how hard is it to add a new rule?", takes 30 seconds.*

**Open `src/rules/goal-security-review.md` in VS Code. Scroll to a category.**

> Watch this. I'm going to add a new check.

*Type a new bullet point under an existing category, e.g.:*
```markdown
- Check for GraphQL introspection enabled in production
```

> That's it. Next run, the agent looks for this. No code changes, no redeploy, no PR review for the agent logic. The expertise is in the file.

---

## APPENDIX A: THE 23 TOOLS

*Quick-reference when someone asks "what tools does it have?"*

| Category | Tool | What it does |
|----------|------|-------------|
| Repo | `list_directory` | List files/dirs, detect binaries |
| Repo | `read_file` | Read with caching + path suggestions |
| Repo | `read_files_batch` | Parallel multi-file read |
| Search | `grep_pattern` | Regex search (ripgrep + Node fallback) |
| Search | `find_files` | Glob pattern file finder |
| Config | `parse_package_json` | Deps, scripts, workspaces |
| Config | `parse_next_config` | Next.js config |
| Config | `parse_tsconfig` | TS settings + path aliases |
| Config | `parse_env_file` | .env parsing (values redacted) |
| Config | `check_gitignore` | Pattern ignore check |
| Deps | `query_npm_versions` | Latest versions (24h cache) |
| Deps | `compare_versions` | Installed vs latest, semver drift |
| Analysis | `analyze_route_structure` | Next.js routes, router type |
| Analysis | `analyze_component_directives` | `'use client'`/`'use server'` scan |
| Analysis | `analyze_env_usage` | Env var references across codebase |
| Analysis | `analyze_middleware` | Auth + site resolver patterns |
| Analysis | `detect_app_roots` | Monorepo workspace detection |
| Analysis | `detect_scope_drift` | Package boundary checks |
| Findings | `record_finding` | Record with evidence + fingerprint |
| Findings | `verify_evidence` | Verify against actual file content |
| Findings | `get_specialist_prompts` | Load domain-specific rules |
| Web | `web_search` | Search approved docs |
| Web | `fetch_url` | Fetch + HTML→Markdown |
| Control | `switch_to_fast_model` | Signal investigation done |
| Control | `assemble_output` | Write final deliverable sections |

---

## APPENDIX B: RULES ARCHITECTURE

*For "how do you encode expertise?" questions.*

**Core** (`src/rules/core.md`), every run:
- Always read package.json first
- Min 8 findings, every category needs at least one
- Evidence integrity: only cite files you've read
- Confidence 1-10: 9-10 verified, 7-8 pattern, 5-6 likely, 3-4 speculative

**Goals**, one per assessment type (10 files)

**Platforms**, one per CMS:
- `platform-sitecore.md`, XM Cloud / JSS patterns
- `platform-optimizely.md`, SaaS CMS / Visual Builder

**Specialists** (`src/rules/specialists/`), loaded on demand:
- graphql, tailwind, prisma, nextjs, cms-sitecore, cms-optimizely

---

## APPENDIX C: CI/CD PIPELINE (9 steps)

*For "what exactly does it do in CI?" questions.*

1. Download previous run artifact (for comparison)
2. Diff findings by fingerprint (new/resolved/persistent)
3. Post PR comment (scorecard + diff, collapsible by category)
4. Add file-level annotations (inline in PR diff, capped at 30)
5. Upload SARIF (GitHub Code Scanning)
6. Apply labels (`radar:security-risk`, `radar:clean`, etc.)
7. Upload run artifact (for next comparison)
8. Fire webhooks (Slack/Teams, 5s timeout)
9. Evaluate quality gate (exit 0 green/yellow, exit 1 red)

Auto-detects: `GITHUB_ACTIONS` → GitHub adapter, `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` → Azure DevOps adapter.

---

## APPENDIX D: TEST COVERAGE

*For "how tested is this?" questions.*

**85 test files, 219+ tests:**

| Category | Files | What |
|----------|-------|------|
| Tool tests | 34 | Every tool: happy path + error |
| Output tests | 11 | Brief, scorecard, JSON, SARIF, CI comment, PDF |
| CI tests | 9 | Adapters, orchestration, quality gates, webhooks |
| Agent tests | 6 | System prompt, retry, budget planner, goal prompts |
| Security tests | 2 | Injection defense, secret redaction |
| E2E tests | 3 | Full loop with stubbed tools |
| Dashboard tests | 7 | Sessions, API routes, URL state, transforms |

---

## CODE WALKTHROUGH REFERENCE CARD

*Quick-lookup for ad-hoc "show me X" requests during Q&A.*

| # | What | File | Line |
|---|------|------|------|
| 1 | Consulting rule | `src/rules/goal-security-review.md` | all |
| 2 | Agent constructor | `src/agent/runner.ts` | ~290 |
| 3 | Event streaming | `src/agent/runner.ts` | ~307 |
| 4 | Model switch trigger | `src/agent/agentLoopContext.ts` | ~412 |
| 5 | Snip boundary | `src/agent/agentLoopContext.ts` | ~414 |
| 6 | Context compression | `src/agent/contextCompression.ts` | ~72 |
| 7 | Budget gate (before) | `src/agent/agentLoopContext.ts` | ~164 |
| 8 | Budget gate (after) | `src/agent/agentLoopContext.ts` | ~317 |
| 9 | Steering messages | `src/agent/agentLoopContext.ts` | ~456 |
| 10 | Provider config | `src/config/piModel.ts` | all |
| 11 | Budget planner | `src/agent/budgetPlanner.ts` | ~147 |
| 12 | Rebalance | `src/agent/budgetPlanner.ts` | ~274 |
| 13 | Pre-compute | `src/agent/runner.ts` | ~178 |
| 14 | Finding extraction (6 shapes) | `src/tools/analysis/recordFinding.ts` | ~152 |
| 15 | Evidence verification (call site) | `src/tools/analysis/recordFinding.ts` | ~349 |
| 15b | Three gates engine | `src/tools/analysis/verifyEvidence.ts` | ~75 (snippet match), ~169 (verify+correct) |
| 16 | Injection patterns | `src/agent/contextBoundary.ts` | ~38 |
| 17 | Prompt caching | `src/agent/contextCompression.ts` | ~195 |
| 18 | Prompt caching wiring | `src/agent/runner.ts` | ~285 |
| 19 | Concurrency/mutex | `src/tools/concurrency.ts` | all |
| 20 | Secret redaction | `src/agent/redaction.ts` | all |
| 21 | System prompt build | `src/agent/systemPrompt.ts` | all |
| 22 | Retry logic | `src/agent/retry.ts` | all |
