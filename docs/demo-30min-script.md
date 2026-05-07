# Radar — 30-Minute Internal Demo Script

Second-monitor guide. Glance at section headers and bullets. Don't read verbatim.

---

## PRE-FLIGHT (30 min before)

- [ ] Pre-generated `goal=all` run visible in sidebar
- [ ] `pnpm dashboard` running, browser at `localhost:3000`, light mode
- [ ] VS Code tabs open:
  1. `src/rules/goal-security-review.md`
  2. `src/config/piModel.ts`
  3. `src/agent/runner.ts` (~line 625 — switch trigger)
  4. `src/agent/runner.ts` (~line 693 — steering messages)
  5. `src/agent/budgetPlanner.ts` (~line 69)
  6. `src/tools/analysis/recordFinding.ts` (~line 133 + ~line 286)
  7. `src/agent/contextBoundary.ts`
- [ ] GitHub test repo URL memorized
- [ ] Sitecore repo URL in clipboard: `https://github.com/Sitecore/xmcloud-starter-js`

---

## THE ARC

| Time | What | You want them thinking |
|------|------|----------------------|
| 0-1 | Hook | "What is this?" |
| 1-3 | Live run kick-off | "It's actually running" |
| 3-7 | Results (pre-generated) | "These are real findings" |
| 7-9 | GitHub Issues | "It just did that?" |
| 9-11 | The numbers | "Under a dollar?" |
| 11-14 | Dual-model architecture | "That's clever" |
| 14-18 | Evidence verification | "It can't hallucinate?" |
| 18-21 | Budget as architecture | "It can't fail silently" |
| 21-24 | Defensive parsing + rules | "This is production" |
| 24-27 | Big picture / harness thesis | "This is a discipline" |
| 27-30 | Q&A | You have answers ready |

---

## 0:00 — THE HOOK (1 min)

> Radar is an AI agent that investigates codebases and produces consulting deliverables. Security reviews, architecture audits, accessibility checks, developer onboarding briefs.
>
> Point it at a repo, pick a goal, it runs autonomously. Ten goal types, 23 tools, under a dollar per run.

**Open the dashboard.**

---

## 1:00 — KICK OFF LIVE RUN (2 min)

**Dashboard idle view. Goal dropdown.**

- Hold the dropdown open 3 seconds. Let them read the goal types.
- "Each one follows its own consulting rules. Plain English markdown. Not code."
- Paste Sitecore URL. Click Pull Repo. Select "All Goals." Click Start.
- Let tool call chips fly for 10-15 seconds.

> No hardcoded sequence. The agent decides what to investigate based on what it finds.
>
> While this runs, let me show you what it produces.

---

## 3:00 — THE RESULTS (4 min)

**Click pre-generated all-goals run in sidebar.**

### Executive Summary + Scoreboard (1 min)

- Point at letter grade, total findings, cost, duration
- Point at goal cards: Security, Architecture, Accessibility, Next.js, Onboarding
- "You get the headline in two seconds."

### Drill Into Security (2 min)

- Click Security card
- Point at per-category scorecard grid (6 categories scored)
- Open a high-severity finding
- Point at: severity badge, category, file path, line number, code snippet

> That snippet was verified against the real file on disk. I'll show you how in a minute.

### Accessibility (1 min)

- Click Accessibility card
- "Different goal, completely different lens. Same 23 tools, same agent. Different rules, different output."

---

## 7:00 — GITHUB ISSUES (2 min)

**Click "Create Issues" button.**

- Point at auto-detected repo. Type test repo name.
- Set severity threshold to "Medium and above"
- Point at preview count

> Duplicates get skipped via fingerprint matching. SHA-256 of category + file path + title. Run this again next month, only new findings create issues.

- Click Create. Wait for green checkmarks.
- Open one issue in GitHub. Show: title, labels, evidence snippet, fingerprint.

> Findings just became your sprint backlog.

---

## 9:00 — THE NUMBERS (2 min)

**Back to multi-goal view. Point at stats.**

- Full all-goals sweep: ~$7, ~8 minutes, [X] tool calls
- Single-goal run: ~$0.74
- 15 validation runs, 5 repos, 100% crash-free, 0 unverifiable evidence

> $1.38 average per assessment. That's not a proof of concept. That's production economics.

**Pause 2 seconds. Let the number land.**

---

## 11:00 — DUAL-MODEL ARCHITECTURE (3 min)

**Show: `src/config/piModel.ts` (whole file, ~77 lines)**

Key points:
- Two models from env vars. Code never says "Sonnet" or "Haiku."
- Investigation model = powerful, expensive (Sonnet). Writing model = fast, cheap (Haiku).
- Change two env vars → different provider. AWS to Azure, no code changes.

**Show: `src/agent/runner.ts` ~line 625 (the switch trigger)**

```
if (toolName === 'switch_to_fast_model' && !modelSwitched) {
```

Key points:
- The agent *itself* decides when to switch. It calls `switch_to_fast_model` as a tool.
- Not a timer. Not a heuristic. Intent-based. The agent knows when investigation is done.
- The moment it switches, context compression tightens. Writing phase doesn't need raw file contents anymore.

> Why let the agent decide? Because some repos need 15 investigation turns, some need 35. No external signal knows when the agent is done investigating. The agent does.

**The fallback chain (show ~line 693 steering area):**

> But LLMs forget instructions. What if it never switches?

- 50% budget → soft reminder: "consider switching"
- 5 calls remaining → force-switch regardless
- Post-loop retries → always use the fast model

> Design for the happy path, build fallbacks for when the LLM doesn't cooperate. Gentle, firm, forced. Three escalation levels.

**Cost punchline:**

> Investigation on Sonnet, writing on Haiku. That split is why a single-goal run costs 74 cents instead of two dollars. 37% savings from one architectural decision.

---

## 14:00 — EVIDENCE VERIFICATION (4 min)

**Show: `src/tools/analysis/recordFinding.ts` ~line 286**

> Most people's anti-hallucination strategy is a system prompt that says "don't hallucinate." Here's what actually works.

**Three gates — walk through each:**

Gate 1: File-read set membership
- We track every file the agent reads in a set
- If the agent cites a file it never opened → evidence rejected outright
- "The agent cannot cite a file it never read."

Gate 2: Snippet verification against disk
- Re-read the actual file. Compare the claimed snippet to real content.
- Normalized comparison: strips whitespace, collapses indentation
- Identifier guard: checks that `UPPER_SNAKE_CASE` names in unmatched lines actually exist in the file
- Catches hallucinated env var names that slip through because boilerplate matched

Gate 3: Auto-correction
- If the snippet is close but not exact (LLM paraphrased or truncated)
- Replace the agent's drifted snippet with the real code at the cited line
- Finding survives, but with actual code

> No second LLM call. Pure string matching. Zero unverifiable evidence across 185 citations in our validation gauntlet.

**The key insight:**

> An agentic system has an advantage over a chatbot: it knows what the agent actually did. Every file read is tracked. Every tool call is logged. Hallucination detection becomes a set membership test plus a string comparison.

---

## 18:00 — BUDGET AS ARCHITECTURE (3 min)

**Show: `src/agent/runner.ts` — beforeToolCall/afterToolCall hooks**

> Most agent demos are "let it cook." In production, that's how you spend $50 and get nothing.

**The failure mode that motivated this:**

> I watched the agent burn 60 tool calls reading files without recording a single finding. Budget exhausted. Zero output. That failure mode is now architecturally impossible.

**Walk through the threshold chain:**

| Budget consumed | Findings recorded | What happens |
|----------------|-------------------|--------------|
| 40% | 0 | Nudge: "start recording now" |
| 50% | any | Nudge: "switch to fast model" |
| 60% | 0 | **Hard gate**: investigation tools BLOCKED, only `record_finding` allowed |
| 5 calls left | any | Force model switch + CRITICAL warning |

> Each threshold was discovered empirically by watching runs fail. The 60% gate with zero findings — that's the one that prevents the catastrophic case.

**Budget extension (interactive):**

> In the dashboard, when budget runs out, the agent pauses. You get "Extend" or "Finish" buttons. The agent is literally suspended mid-run waiting for a human decision. In CI, it auto-finishes. Same mechanism, different context.

**Multi-goal budget planner (briefly):**

- `planBudget()` — splits budget across passes using pre-computed signals
- `rebalanceBudget()` — adjusts after core pass based on what was actually found
- "Pure functions. No LLM. Deterministic budget intelligence."

---

## 21:00 — DEFENSIVE PARSING + RULES (3 min)

### The 6 Shapes Problem (1.5 min)

**Show: `src/tools/analysis/recordFinding.ts` ~line 133**

> LLMs don't follow JSON schemas reliably. I've catalogued six different shapes the model produces for what should be a simple `{ finding: {...} }`:

1. Correct per schema
2. Flat (no wrapper)
3. Double-nested (`finding.finding`)
4. Array of findings
5. Top-level array
6. Array-as-object-keys (`"0": {...}, "1": {...}`)

> A retry costs 2 tool calls — 4% of your budget. So instead of fighting the model, I handle all six shapes with zero retries. The LLM sends whatever it wants. We normalize.

### Rules Are Markdown (1.5 min)

**Show: `src/rules/goal-security-review.md` — scroll slowly**

- Plain English. Categories, severity criteria, what to look for, what counts as evidence.
- "Want a new assessment type? Write a markdown file. No code changes. The agent picks it up on the next run."
- "The expertise lives in the rules, not the codebase. That's institutional knowledge that doesn't walk out the door."

---

## 24:00 — THE BIG PICTURE (3 min)

### The Four Layers (briefly)

> 1. Rules (plain English markdown — the mission)
> 2. Agent runtime (observe-reason-act loop — the intelligence)
> 3. 23 deterministic tools (read files, parse configs — the facts)
> 4. Structured output (scorecards, PDFs, GitHub Issues — the deliverable)
>
> No layer reaches into another. The agent connects them.

### The Harness Engineering Thesis

> Every team has access to the same Sonnet and Haiku. The model is a commodity. The differentiation is everything around it:
>
> - Context compression (what to keep, what to evict)
> - Budget enforcement (when to nudge, when to force)
> - Evidence verification (what to trust, what to reject)
> - Model switching (who decides, when, with what fallbacks)
>
> Stanford calls this "harness engineering." The harness is the product. The model is the engine.

### The Close

> Radar: 10 goal types, 23 tools, plain English rules. Under a dollar per run. Runs on any provider. Findings become trackable work items.
>
> Built in three weeks. 85 test files. 219 tests. Zero hallucinated evidence.
>
> Happy to dig into anything.

---

## Q&A READY ANSWERS

**"How is this different from SonarQube / Snyk?"**
Those are pattern matchers. They check syntax rules and known CVEs. Radar reasons about architecture — it understands that three components need to be wired together, or that a dependency is incompatible with the App Router. Reads code like an engineer, not a regex.

**"Can it hallucinate findings?"**
Deterministic evidence verification. File-read gate, snippet match against disk, auto-correct or reject. No LLM in the verification loop. Zero unverifiable evidence across 185 citations.

**"What if it misses something?"**
It will. The value is the 80% it catches in 8 minutes. The architect reviews, adjusts severity, adds business context. Agent does the reading, human does the thinking.

**"Can it fix the issues?"**
Not yet, read-only today. But every finding has file-level evidence. Auto-fix is a natural next step with more guardrails.

**"How do we add a new CMS or framework?"**
Write a platform rules file in markdown. Write reference files for the framework's patterns. Agent picks them up next run. Zero code changes.

**"What does it cost?"**
Under a dollar single-goal. ~$7 for the full all-goals sweep. Cost scales linearly with tool budget.

**"Can this run in CI?"**
Yes. Auto-detects GitHub Actions and Azure DevOps. PR comments, file annotations, SARIF, labels, quality gates, trend tracking. Fails a PR if critical findings.

**"Is this tied to Sitecore?"**
No. Generic audit goal works on any web framework. CMS-specific goals just layer platform rules on top. Architecture is framework-agnostic.

**"Can clients run this themselves?"**
Yes. Clone, set env vars, `pnpm install`, `pnpm dashboard`. Runs in their network. No SaaS dependency.

**"How long did this take?"**
Three weeks. 85 test files, 23 tools, 10 goal types. Once the layers are in place, a new goal type takes an afternoon.

**"What agent framework?"**
Pi Agent (open-source TypeScript). We added budget control, model switching, context compression, prompt caching on top. Tools and rules are framework-agnostic.

**"What if the agent doesn't cooperate?"**
Three escalation levels: soft nudge, hard gate, forced override. Post-loop retry if it never assembled output. Architecturally impossible to produce nothing.

---

## FALLBACK PLAYS

**Live run doesn't finish in time:**
"It's still running — that's fine, takes about 8 minutes. Everything I'm showing you is from a completed run against the same repo."

**Pre-generated run missing:**
Run Security Review live (~2 min). Demo single-goal view. Explain multi-goal verbally.

**GitHub Issues fails:**
Show the modal up to preview. "Permissions issue on the test repo right now, but you see: 8 issues, 3 high, 5 medium, fingerprint dedup."

**Running long on code walkthrough:**
Cut defensive parsing section first (least essential). Budget section second. Never cut dual-model or evidence verification.

**Someone asks to see a file you don't have tabbed:**
Cmd+P in VS Code. Key files:
- `src/agent/goalPrompts.ts` — how goal prompts are templated
- `src/tools/concurrency.ts` — mutex pattern
- `src/agent/retry.ts` — retry logic
- `src/output/scorecard.ts` — score computation
- `src/ci/orchestrator.ts` — CI pipeline

---

## TIMING CHECKPOINTS

If you're here at this time, you're on pace:

| Clock | You should be at |
|-------|-----------------|
| 3:00 | Starting pre-generated results |
| 9:00 | Starting "the numbers" |
| 11:00 | Starting code walkthrough |
| 24:00 | Starting big picture |
| 27:00 | Opening Q&A |

If behind by 3+ minutes at any checkpoint, skip to the next section.
