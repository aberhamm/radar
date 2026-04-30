# TODOs — repo-audit-delivery-agent

Cleaned up 2026-04-28. History archived at `docs/archive/TODOS-pre-demo.md`.

## P1 — Orchestrator Architecture (parallel worker model)

See [docs/orchestrator-plan.md](docs/orchestrator-plan.md) for full design and rationale.

- [ ] **Stage 1: Extract runner closure state** — Pull 15+ closure variables from `runner.ts` into an `AgentLoopContext` object. Convert hooks to methods. Pure refactor, zero behavior change. Files: `src/agent/runner.ts`.
- [ ] **Stage 2: Add worker mode to runner** — Add `mode: 'full' | 'worker'` to `RunnerConfig`. Worker mode disables model switching, steering nudges, extension gates, and post-loop retries. Workers call `record_finding` only. Files: `src/agent/runner.ts`, `src/agent/runnerTypes.ts`.
- [ ] **Stage 3: Cluster-aware budget planner + parallel dispatch** — Expand `budgetPlanner.ts` from 3 fixed passes to N goal-dependent cluster passes. Add per-cluster prompt templates to `goalPrompts.ts`. Modify `analyzeAll.ts` to dispatch all cluster workers in parallel. Files: `src/agent/budgetPlanner.ts`, `src/agent/goalPrompts.ts`, `src/commands/analyzeAll.ts`.
- [ ] **Stage 4: Synthesis runner** — New lightweight agent (Haiku) that receives merged findings, identifies cross-cutting connections, writes narrative sections, and calls `assemble_output`. Files: new `src/agent/synthesisRunner.ts`, `src/commands/analyzeAll.ts`.
- [ ] **Stage 5: Dashboard parallel mode toggle + swim lane UI** — Add Standard/Parallel radio toggle to `IdleView.tsx` (disabled for single-goal/ci-check). Pass `parallel` flag through `/api/run` to `dashboardAnalyzeAll`. Tag worker events with `workerId`/`workerName`. New `WorkerLaneGrid.tsx` (vertical swim lanes per worker) and `SynthesisBar.tsx` (convergence view). PhaseRail shows worker count. Responsive: columns on desktop, tab switcher on narrow. Mockup: `docs/mockups/parallel-workers.html`. Files: `IdleView.tsx`, `/api/run/route.ts`, `runTransform.ts`, `AnalysisView.tsx`, `PhaseRail.tsx`, new `WorkerLaneGrid.tsx`, new `SynthesisBar.tsx`.
- [ ] **A/B testing** — Run both architectures (current single-agent vs. parallel workers) against same repos. Compare output quality, cost, and wall-clock time.
- [ ] **Remove `detect_scope_drift` tool** — Not referenced in any goal rules, no tests, duplicates LLM reasoning. Remove tool + adapter + validator + concurrency entry. Add one line to investigation rules about noting README contradictions.

## P2

- [ ] **Excessive monorepo root handling** — Repos like Refine dump 254 app roots into a flat `<select>`. Needs: searchable/filterable combobox, grouping by top-level directory, sensible cap (top 20 by framework relevance, "show all" expander).
- [x] **Keyboard navigation for findings/sidebar** — J/K nav implemented in FindingsTriagePage and FindingDetailPanel.
- [ ] **Prompt cache hit rate monitoring** — Zero visibility into Portkey prompt cache hits (cachedTokens defaults to 0). Fixing cache could be 30-50% speedup. Check Portkey dashboard or add debug logging for cache_read_input_tokens.
- [ ] **Auto-create issues from findings — CLI flag** — Core implementation done (`src/ci/githubIssues.ts`, `CreateIssuesModal.tsx`, `/api/create-issues` route). Remaining: wire `--create-issues` CLI flag into `analyze.ts`.
- [ ] **Hosted dashboard demo** — Deploy dashboard to internal URL with pre-loaded gauntlet runs. Practice leads browse without installing.
- [ ] **Comparative benchmarking** — Cross-repo ranking (percentiles, category averages, outlier detection). Needs 20+ gauntlet runs for meaningful data.

## P3

- [ ] **Running cost counter in verbose mode** — Show per-turn cost accumulation, cache hit ratio, and cost projection during `--verbose` runs.
- [ ] **Hook system for extensibility** — Event-driven hooks (PreAnalysis, PostAnalysis, OnFinding, PostAssembly) configured in settings file, executed as shell subprocesses.
- [ ] **MCP server mode** — Expose 23 tools as MCP tools via stdio transport. ~200 lines.
- [ ] **Read-only assertion guard** — Assert at startup that no tool can write to the target repo.
- [ ] **Score badge generation** — Needs hosting story.
- [ ] **GitLab CI native template** — Docker image works as fallback for any CI platform.
- [ ] **QA issue taxonomy severity definitions** — Port 7-category taxonomy with 4-level severity scale as calibration reference.
- [ ] **Findings trend dashboard** — Visualize findings over time per repo. Charts: new/resolved/persistent per run, severity distribution, confidence drift.
- [ ] **Per-pass budget extension in BudgetPausedView** — Show which pass exhausted and offer per-pass extension.
- [ ] **Description-evidence coherence tuning** — Check warning rate after gauntlet, tighten extraction regexes if too noisy.
- [ ] **Coherence warnings in dashboard** — Surface recordFinding coherence/no-evidence warnings in FindingCard UI.
- [ ] **Playwright E2E tests for dashboard routing** — URL routing has no E2E coverage.
- [ ] **SSR pre-fetch for shared run URLs** — Pre-fetch via server component for faster first paint.
- [ ] **Full App Router migration** — Migrate from catch-all `[[...slug]]` + pushState to proper route segments.
- [ ] **Writing fan-out** — Split brief writing across parallel Haiku agents post-investigation.
- [ ] **Dashboard concurrent sessions** — Replace global singleton session with per-session isolation.
- [ ] **Generator-based agent loop wrapper** — Wrap Pi's callback events in async generator. Parked until Pi's event model becomes bottleneck.

## Dashboard polish

- [ ] **ActivityChipGroup needs more vertical padding around tools**
- [ ] **Replay happens too fast and doesn't look real**
- [ ] **Files examined section** — shouldn't scroll, should expand on child files added
- [x] **Remove scorecard from live run viewer**
