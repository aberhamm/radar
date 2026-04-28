# TODOs — repo-audit-delivery-agent

Cleaned up 2026-04-28. History archived at `docs/archive/TODOS-pre-demo.md`.

## P2

- [ ] **Excessive monorepo root handling** — Repos like Refine dump 254 app roots into a flat `<select>`. Needs: searchable/filterable combobox, grouping by top-level directory, sensible cap (top 20 by framework relevance, "show all" expander).
- [ ] **Keyboard navigation for findings/sidebar** — No J/K nav in sidebar or findings. CommandPalette can't target findings/sections. Needed for "precision instrument" UX.
- [ ] **Prompt cache hit rate monitoring** — Zero visibility into Portkey prompt cache hits (cachedTokens defaults to 0). Fixing cache could be 30-50% speedup. Check Portkey dashboard or add debug logging for cache_read_input_tokens.
- [ ] **Auto-create issues from findings** — Optionally create GitHub Issues / Azure DevOps Work Items from findings. Fingerprint-based dedup, configurable severity threshold, `--create-issues` CLI flag, dashboard button. CI adapters already have API scaffolding.
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
- [ ] **Remove scorecard from live run viewer**
