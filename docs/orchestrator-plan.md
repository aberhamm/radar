# Orchestrator Architecture Plan

## Problem

The core investigation pass uses a single agent with a broad mandate covering 6+ categories. Budget-based guardrails police tempo (are you recording findings fast enough?) but not direction (are you investigating the right things?). This causes:

- **Scope drift** — agent wanders off-goal, investigating irrelevant areas
- **Rabbit-holing** — agent spends 15 calls on one category while ignoring others
- **Category gaps** — required categories get zero findings because the agent ran out of budget elsewhere

The existing specialist passes (Next.js, Accessibility) don't have this problem because they're focused. The fix is to make everything focused.

## Design: Deterministic Orchestration + Parallel Workers + LLM Synthesis

```
preCompute (exists)          <- recon, no LLM
    |
budgetPlanner (code)         <- assigns clusters + budgets per goal
    |
+-----------------------------------------------+
|  Worker: Security + Config        (budget 8)   |
|  Worker: Stack + Architecture    (budget 10)   |
|  Worker: CMS + Preview           (budget 8)    |  <- parallel, isolated state
|  Worker: Deps + Deployment       (budget 6)    |
|  Worker: Next.js (if detected)   (budget 8)    |
|  Worker: Accessibility (if UI)   (budget 8)    |
+-----------------------------------------------+
    |
Evidence verification (exists)  <- deterministic, per worker
    |
Merge + dedup (exists)          <- stateMerge + deduplicateFindings
    |
Synthesis agent (new, Haiku)    <- cross-cutting connections, narrative, assemble_output
```

### Key decisions

1. **No LLM orchestrator.** `preCompute` detects the stack. `budgetPlanner` decides what to run and with how much budget. Code doesn't hallucinate, drift, or waste tokens on decisions a lookup table can make.

2. **Workers are isolated.** Each gets its own `AgentState`, hard budget, category-scoped prompt, and relevant rules subset. Scope drift is structurally impossible — a worker with 8 calls and a mandate of "security + configuration" can't rabbit-hole on CSS.

3. **Synthesis recovers cross-cutting insight.** Isolated workers can't connect findings across clusters. The synthesis agent (Haiku, cheap) receives all merged findings, can read files, and connects the dots: "the outdated dependency from Worker 4 is the same auth library Worker 1 flagged as misconfigured."

4. **Existing infrastructure handles most of the work.** `stateMerge.ts`, `deduplicateFindings()`, `verifyEvidence()`, parallel dispatch in `analyzeAll.ts`, and `preCompute` all exist and don't change.

## Category clusters (universal/audit goal)

| Cluster | Categories | Why grouped |
|---------|-----------|-------------|
| Security + Config | security, configuration | Read the same files (env, gitignore, headers, CSP) |
| Stack + Architecture | stack, architecture, routing | Framework detection flows into routing into architecture |
| CMS + Preview | cms-integration, preview-editing | SDK usage, content delivery, and editor experience are coupled |
| Deps + Deployment | dependencies, deployment | Version currency affects build pipeline affects hosting |
| Next.js | nextjs, data-fetching, performance | Framework-specific depth (skip if not Next.js) |
| Accessibility | media-alt, semantic-html, keyboard-focus, forms, color-contrast, aria | Component-level inspection (skip if no UI framework) |

Clusters are goal-dependent. `security-review` has different clusters (one per security category). `ci-check` stays single-agent (budget too small to split).

## What changes vs. what stays

| Stays | Changes |
|-------|---------|
| All 23 tools | `runner.ts` gets worker mode |
| `preCompute` | `budgetPlanner` expands from 3 to N passes |
| `stateMerge` + dedup | `analyzeAll.ts` dispatches cluster workers |
| Evidence verification | New: `synthesisRunner.ts` |
| Rules files | New: per-cluster prompt templates in `goalPrompts.ts` |
| Output schema | |
| Dashboard | |

## Implementation stages

### Stage 1: Extract runner closure state

**Goal:** Make `runner.ts` reusable for multiple worker instances.

**Problem:** `runner.ts` has 15+ closure variables (`currentBudget`, `terminationReason`, `modelSwitched`, `extensionGateFired`, `budgetWarning5Sent`, `progressSummarySent`, etc.) inside a single function. These resist extraction because the `beforeToolCall` and `afterToolCall` hooks reference all of them.

**Work:**
- Extract closure variables into an `AgentLoopContext` class/object
- Convert `beforeToolCall` and `afterToolCall` hooks to methods on this object
- Pure refactor — zero behavior change

**Files:** `src/agent/runner.ts` (split into `runner.ts` + `agentLoopContext.ts`)

**Validates:** Tests still pass, output identical to current.

### Stage 2: Add worker mode to runner

**Goal:** A lightweight runner mode for focused workers that don't need full orchestration overhead.

**Work:** Add `mode: 'full' | 'worker'` to `RunnerConfig`. In worker mode:
- Disable model switching (workers run on a single model)
- Disable steering nudges (recording gate, budget warnings, progress checkpoints)
- Disable extension gates (workers have fixed budgets)
- Disable post-loop retry nudges (no assemble_output in workers)
- Workers call `record_finding` only, never `assemble_output`
- Return findings + state

**Files:** `src/agent/runner.ts` (~50 lines of `if (mode !== 'worker')` guards), `src/agent/runnerTypes.ts`

**Immediate benefit:** Existing Next.js and Accessibility specialist passes become leaner when run in worker mode.

### Stage 3: Cluster-aware budget planner + parallel dispatch

**Goal:** Replace serial core pass + parallel specialists with all-parallel cluster workers.

**Work:**
- Expand `budgetPlanner.ts` from 3 fixed passes to N passes. Each goal type defines its cluster configuration (which categories, base budget fraction, skip conditions).
- Add per-cluster prompt templates to `goalPrompts.ts`. Each worker gets: cluster categories, relevant rules subset, preCompute context summary, and the shared recon output.
- Modify `analyzeAll.ts` to dispatch all cluster workers in parallel via `Promise.all()`, each with `mode: 'worker'`, then merge results with existing `stateMerge` + `deduplicateFindings`.
- Budget rebalancing becomes pre-dispatch (based on preCompute signals) rather than post-core.

**Files:** `src/agent/budgetPlanner.ts`, `src/agent/goalPrompts.ts`, `src/commands/analyzeAll.ts`

**Risk:** Budget allocation without seeing core results is less adaptive. Mitigation: `preCompute` already detects stack, frameworks, and plugins — sufficient for budget decisions.

### Stage 4: Synthesis runner

**Goal:** Recover cross-cutting insight that isolated workers lose.

**Work:**
- New `src/agent/synthesisRunner.ts` — lightweight agent that receives merged findings
- Tools: `read_file`, `read_files_batch`, `record_finding` (for cross-cutting additions), `assemble_output`
- Model: Haiku (writing, not investigating)
- Budget: ~10 calls (mostly reading files to verify cross-cutting connections, then assembling)
- Prompt: "Here are N findings from isolated investigation passes. Identify cross-cutting connections. Write narrative sections. Assemble the output."

**Files:** New `src/agent/synthesisRunner.ts`, modify `src/commands/analyzeAll.ts` to call it after merge

**Quality risk:** This is the piece that determines whether parallel workers produce output as good as the single-agent approach. Needs A/B testing against real repos.

## Risks

1. **Output quality from isolation.** Workers can't see each other's findings. The synthesis pass mitigates this but works from summaries, not from having read the code firsthand. A/B testing required.

2. **Budget allocation is less adaptive.** Without seeing core results, budget splits rely on `preCompute` signals. Edge case: preCompute detects Next.js but the repo barely uses it — Next.js worker wastes its budget. Acceptable tradeoff for parallelism.

3. **LLM cost may increase.** Each worker gets its own Pi Agent instance with system prompt + tool definitions. 6 workers = 6x fixed overhead. Shorter conversations offset this, but measure it.

4. **Rate limits under parallelism.** 6 concurrent workers all hitting the same API endpoint. Verify provider tier supports the concurrency.

5. **Evidence verification assumes worker's own `filesRead`.** Workers only track files they read. If a worker cites a file from preCompute context, evidence verification may reject it. Fix: inject preCompute file list into each worker's initial `filesRead`.

## Stage 5: Dashboard — parallel mode toggle + swim lane UI

### Mode toggle in IdleView

Add a "Standard / Parallel" radio toggle to `IdleView.tsx` next to the goal picker. Parallel mode is only available for multi-goal runs with budget > 30. For single goals or `ci-check`, the toggle is disabled.

The toggle sends `{ parallel: true }` in the POST body to `/api/run`. The API route passes it through to `dashboardAnalyzeAll`, which branches: serial path (existing) or parallel cluster dispatch (new).

**Files:** `dashboard/src/components/IdleView.tsx` (~30 lines), `dashboard/src/app/api/run/route.ts` (pass flag through)

### Event model changes

Workers tag every `onStep` event with `workerId` (e.g., `"worker-security"`) and `workerName` (e.g., `"Security + Config"`). The SSE stream interleaves events from all workers. `runTransform.ts` groups events by `workerId` for the lane grid but displays them interleaved for the unified findings panel.

**Files:** `dashboard/src/lib/runTransform.ts`, `src/commands/analyzeAll.ts` (tag events)

### Swim lane UI (WorkerLaneGrid)

Replaces `ReasoningStream` when parallel mode is active. CSS grid of vertical columns, one per worker. Each lane has:

- **Lane header** — worker name, colored dot (active/pulsing or complete/green), tool call counter (e.g., "6/8")
- **Lane progress bar** — thin 2px bar below header, fills per worker
- **Lane stream** — mini `ReasoningStream` with compact `TurnItem` components, tool chips, finding severity chips
- **Thinking indicator** — 3-dot pulse with current tool name, per lane
- **Complete state** — checkmark animation, "N findings recorded"

Lanes finish at different times. A completed lane goes green and quiet while others keep streaming.

**Files:** New `dashboard/src/components/analysis/WorkerLaneGrid.tsx`, modify `dashboard/src/components/AnalysisView.tsx` (conditional render)

### Synthesis convergence

When all workers complete, lane dividers animate away and a full-width synthesis bar appears at the bottom of the grid (spans all columns). Shows:

- "SYNTHESIS" badge in warning/gold
- Cross-cutting connections discovered (e.g., "Deps: outdated JSS SDK -> CMS: deprecated editing API")
- Synthesis agent reasoning as it writes the final report

**Files:** New `dashboard/src/components/analysis/SynthesisBar.tsx`

### PhaseRail changes

Standard mode: unchanged (single progress bar).
Parallel mode: progress bar stays as aggregate. Add worker count + completion count: "4 workers · 2 complete".

**Files:** `dashboard/src/components/analysis/PhaseRail.tsx` (~20 lines)

### Right panel

Unchanged — findings list and files examined work the same. Findings arrive from all workers, tagged with source worker in the `finding-source` line.

### Responsive

Desktop (>1200px): 4-6 columns side by side.
Tablet/narrow: horizontal pill selector at top, one lane visible at a time (tab switching).

### Mockup

Static HTML mockup at `docs/mockups/parallel-workers.html`. Open in browser to preview. Uses actual design tokens from DESIGN.md, dark mode support, and existing animation keyframes.

## Cleanup: detect_scope_drift tool

The `detect_scope_drift` tool (13 regex patterns matching README claims against file existence) is not referenced in any goal rules, has no tests, and duplicates what the LLM does naturally during investigation. Remove it and add one line to investigation rules: "Note any contradictions between README/docs claims and what you observed during investigation."
