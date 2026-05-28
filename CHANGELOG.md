# Changelog

All notable changes to repo-audit-delivery-agent (radar).

## [Unreleased] — 2026-05-27

### Added
- **Specialist worker mode.** Sub-agents handle platform-specific checklists (Sitecore JSS 22.12, Optimizely dual-SDK) in parallel. Dedicated UI panel shows specialist progress inline.
- **Performance goal.** New `--goal performance` audits Core Web Vitals, bundle size, and runtime performance across 6 categories.
- **Timeline observability.** Step-by-step timeline view with inline specialist display, always-on traces, and continuous step numbering.
- **In-app source file viewer.** Click any finding's file path to see the source code with highlighted evidence lines — no editor needed.
- **Multi-select goal picker.** Choose multiple goals from the dashboard UI instead of running them one at a time.
- **Unified findings accordion.** Goal → Category → Finding drill-down for multi-goal runs with deep-linkable findings and cross-run dedup.
- **`load_reference` tool.** Agent can now selectively load knowledge files (updated to Next.js 16 era) instead of dumping all references into context.
- **Extended thinking.** Investigation model uses extended thinking for deeper reasoning during complex analysis.
- **Health endpoint and demo mode.** `/api/health` for monitoring, demo mode with well-known fixture run for onboarding.
- **Structured logging.** Per-tool timing, golden snapshot tests, and typed error codes for observability.
- **Dashboard changelog page.** View release history and updates directly in the sidebar.
- **Server-side LRU cache.** Disk reads cached in-memory for faster dashboard page loads.
- **E2E test infrastructure.** Playwright setup with fixture data, navigation/smoke tests, live analysis SSE mocks, findings interaction tests, visual regression baselines, API route integration tests, and CLI command coverage.
- **GitHub Actions CI pipeline.** Full test suite runs on every PR: typecheck → unit → integration → E2E → visual regression.

### Changed
- **Runner decomposition.** `runner.ts` split into 8 focused modules with centralized constants for maintainability.
- **Unified RunView shell.** `CompleteView` and `MultiGoalView` merged into a single component. Multi-goal runs collapse in Recent Runs list showing the full repo name.
- **IdleView redesign.** Landing page redesigned with pre-computed run data and finding progress indicators.
- **pi-agent-core upgraded to v0.70.2.** Tool details now thread through to the UI for richer interaction display.

### Fixed
- Budget pause modal no longer re-fires; extension offered at 60% before forcing recording. Heartbeat + timeout ensure reliable pause/resume.
- Timeline tab hidden on multi-goal runs where it doesn't apply.
- Runs page no longer empty when history only contains child runs.
- Modern Sitecore/Optimizely SDK packages now correctly detected for specialist matching.
- Dashboard scroll, findings table, copy, file preview, PDF export, and root detection issues resolved.
- Dialog grid overflow, blinking cursor replaced with fade-in, timeline rail overshoot fixed.
- 404 console noise eliminated, stale test tab names corrected.
- All event types now persisted for CLI/dashboard parity.

### Performance
- 13 optimizations across agent runner and dashboard (pre-compute, lazy loading, reduced re-renders).

<!-- commits: f99d3f8, 11ed4a9, c029020, ff3b963, ed4fe69, 49775cc, 6030584, 4b204b0, f70b7d7, c3981ae, d7f985d, 8a0c3ff, 43007b8, a5c9e49, c71ecb5, 143ba70, ae1ba55, a25217d, 0616387, 3bdd79c, 03f3d44, fc2fc15, 3221b69, b30f7c6, 6069926, c4074dd, e61cc80, cf36209, a53e5d4, e005981, 5074303, 4952023, 0741335, d8f37fa, d565bda, 3210d49, 91e8a5d, 69e9ee2, 81827c7, 20591ed, 8205c76, 048be65, 63f7aa1, c7bdca5, 79bf17e, a24165a, f390971, 245bab8, 7ceda63, 51746fb, acc759c, ce5d266, 287998f, b365418, aa242fe, 2128d6a, 48140f2 -->

## 2026-04-24

### Added
- **Client-ready PDF export.** `--export-pdf` generates branded PDF reports (cover page, executive summary, scorecard, findings) from CLI and dashboard. Dashboard gets a one-click PDF download button.
- **Universal investigation (`--goal all`).** Runs all applicable goals in a single session with tiered budget allocation, per-pass tracking, and post-core rebalancing. Universal goal prompt and rules, `goalBriefWriter` and `multiGoalSummary` renderers, `mergeState()` for cross-goal state accumulation. 42 new tests.
- **Dashboard multi-goal view.** Single-page layout with collapsible per-goal sections, direct URL navigation, provider abstraction layer, and multi-goal history rendering.
- **Dashboard URL routing.** Deep-linkable routes for reports, history, compare, and individual runs. Sidebar nav, cross-linking, run cache with hover prefetch.
- **Sidebar v2.** Icon rail + sliding detail panel. History as default view, "New Analysis" moved to header. Auto-close on mobile deep-link navigation.
- **Parallel compare.** Side-by-side run comparison with pre-computation layer and per-turn timing.
- **File tree viewer.** Visual file tree component in dashboard.
- **Reasoning UI enhancements.** Connector rail, status icons, richer tool-call interactions, replay stream indicators aligned on vertical rail, writing-phase turn filtering.
- **Skeleton loading states.** Shimmer placeholders across dashboard views with test coverage.
- **Evidence verification v2.** `sourceContext` and coherence checks added to the verification system. Dashboard renders verification badges on evidence.
- **Executive summary renderer.** Standalone renderer for brief executive summaries.
- **Audit-generic mode.** Platform-agnostic audit with monorepo root selection for non-CMS codebases.
- **`radar gauntlet` command.** Cross-repo quality runs for batch validation.
- **`clone_repo` tool.** Clone remote repositories for analysis without local checkout.
- **GitHub issue creation.** Create issues directly from findings (requires `GITHUB_TOKEN`).
- **CI fingerprint dedup.** Improved cross-run finding matching for trend tracking.
- **Tiered run storage.** Disk-backed storage with rerun-from-history, compare, and history APIs. Lazy-loads 34MB event files on demand.
- **DESIGN.md design system.** Formal design system applied to dashboard — CSS variables replace hardcoded colors, ARIA attributes added to navigation.
- **Optional snippets.** Evidence snippets now optional in findings for lighter output.
- **Scorecard metadata.** Enriched scorecard entries with additional context fields.
- **Dev-mode loader.** Simplified loader that always uses `dist/`, with `predev` build step.

### Fixed
- Replay findings missing from dashboard playback.
- Mutex drain and recording gate enforcement to prevent finding loss under concurrency.
- Deferred abort on `assemble_output` to preserve batched findings.
- Budget allocation and recording prompt corrections for `--goal all`.
- Stale closure in `handleSelectHistory` breaking multi-goal view.
- Infinite redirect loop in dashboard routing.
- Stale `goal=all` checkpoint duplicating sidebar entries.
- History clicks now land on reports page correctly.
- Stale Turbopack cache + duplicate scorecard keys.
- PDF export 500 error, CLI dry-run and budget validation edge cases.
- Granular finding categories to eliminate cross-goal scorecard contamination.
- Granular a11y finding categories for accessibility goal.
- Context compression, budget exhaustion handling, file dedup summaries, post-assembly progress.
- Tab deep-links, mobile sidebar, and tile accessible names.
- `onBudgetExhausted` wired into multi-goal runs, React key warnings resolved.
- Replay button, infinite event polling, and sample run data in dashboard.

### Changed
- Portkey gateway config extracted to shared module.
- Per-pass budget tracking with reworked defaults for `--goal all`.
- Deterministic budget planning with post-core rebalancing for multi-goal runs.
- Hardcoded hex colors replaced with CSS variables; hardcoded hover colors replaced with theme-aware values.

## 2026-04-09

### Added
- **CI/CD platform integration.** Drop radar into a client's GitHub Actions or Azure DevOps pipeline with one-line setup. Auto-detects the platform from environment variables. PR comments with collapsible findings by category, trend tracking (New/Resolved/Persistent), inline file annotations (capped at 30), auto-labels, SARIF upload for GitHub Code Scanning, and configurable quality gates.
- **GitHub Actions adapter** (`src/ci/github.ts`). Native `fetch()` to GitHub REST API. PR comments with update-in-place via `<!-- radar-ci-comment -->` marker. Check run annotations. Artifact management for cross-run trend tracking. SARIF upload with graceful 403 fallback for repos without Advanced Security.
- **Azure DevOps adapter** (`src/ci/azureDevops.ts`). PR thread comments, file-anchored annotations, capabilities probe at init, pipeline artifacts. Comment pagination capped at 1000 threads.
- **CI orchestrator** (`src/ci/orchestrator.ts`). Single `orchestrateCi()` call coordinates all post-analysis CI operations. Each operation logged to `CiOperationsLog` for structured debugging.
- **SARIF 2.1.0 generator** (`src/output/sarif.ts`). Converts findings to SARIF with severity mapping (critical/high to error, medium to warning, low/info to note). Includes fingerprints for code scanning dedup.
- **`radar diff` command** (`src/commands/diff.ts`). Compare findings between two runs. Matches by fingerprint field, falls back to SHA-256 of category+filePath+normalizedTitle.
- **Quality gates** (`src/ci/qualityGate.ts` + `config/quality-gates.json`). Configurable `failOn` (exit 1) and `warnOn` (exit 0 + warning) thresholds. Replaces hardcoded red=1 logic.
- **Webhook notifications** (`src/ci/webhook.ts`). Fire-and-forget POST to Slack/Teams. 5s timeout. URL validated against domain blocklist for SSRF protection.
- **Enhanced PR comments.** Collapsible `<details>` sections grouped by category. Trend column when previous run data is available. Progressive truncation at 60K chars for GitHub's comment limit.
- **Docker image.** Multi-stage `node:20-slim` build for GHCR distribution.
- **GitHub Action** (`.github/actions/radar/action.yml`). Reusable composite action using the Docker image.
- 9 new test files covering all CI modules (80 tests).

### Removed
- `src/output/githubHook.ts`. Replaced by native `fetch()` CI adapters. The `gh` CLI is no longer required.

### Changed
- `src/commands/analyze.ts` now calls `orchestrateCi()` instead of the old `githubHook` functions. JSON output includes `ciOperations` array.
- `src/output/ciComment.ts` header changed from "CI Health Check" to "Radar CI Check".

## 2026-04-06

### Added
- **Expanded stack detection.** `detect_app_roots` now identifies 12+ framework signatures and monorepo tooling (Turborepo, Nx, Lerna, pnpm workspaces).
- **Confidence calibration.** Every finding carries a 1-10 confidence score. Scoring excludes speculation (<=2), CI blocks only on high-confidence issues (>=7), the brief renders badges and moves low-confidence findings to an appendix.
- **Session resume and checkpointing.** Checkpoints saved as JSONL every N tool calls. `--resume <path>` hydrates prior state and injects a finding summary into the goal prompt.
- **Snip boundary.** When the model switches to Haiku, context compression drops aggressively (mid-age to 80 chars, old to 40 chars), reducing writing phase context by ~60%.
- **Finding fingerprints.** SHA-256 of `category + filePath + normalizedTitle` enables cross-run trend tracking without a database.
- **Secrets archaeology.** 22 known credential prefix patterns (AWS, GitHub, Stripe, Slack, Google, etc.) added to the security-review goal.
- **Sophisticated retry.** Per-error-type tiers: 429 rate-limit gets 8 attempts, 529 overload gets 3, 502/503 gets 5, connection errors get 5. Respects `Retry-After` headers. Stale connection detection.
- **Next.js goal** (`goal-nextjs.md`). 7-category framework health audit.
- **Accessibility goal** (`goal-accessibility.md`). WCAG 2.1 AA compliance across 6 categories.
- **Component-map goal.** Structured component inventory with CMS bindings.
- **Expanded Optimizely rules.** Visual Builder, Content Graph, @remkoj ecosystem, 16 issue patterns.
- **Session cost persistence.** Per-run costs to JSONL for cross-run analysis.

## 2026-04-05

### Fixed
- **Evidence verification.** Catches hallucinated identifiers, corrects line numbers, deduplicates findings. Three-layer system: record-time verification, evidence chain tracking, post-investigation pass.

## 2026-04-04

### Added
- **Live analysis view.** Dashboard shows real-time agent reasoning during active runs.
- **Animated replay.** Step through completed investigations in the dashboard.

### Fixed
- Budget pause/resume flow in dashboard. API error handling, SSE staleness polling.
- Dashboard polish: score dots in history, replay guard, chip styling.

## 2026-04-03

### Added
- **Production hardening.** 13 items across tool system, concurrency, and context management.
- **Tool concurrency safety.** `StatefulToolMutex` serializes stateful tools while read-only tools run in parallel. Budget enforcement moved to `afterToolCall` for race-free counting.
- **Deferred tool loading.** 3 infrequently-used tools load on demand via `tool_search` meta-tool, saving context tokens.
- **Tool system upgrades.** Ripgrep integration, binary file detection, Levenshtein suggestions on ENOENT, per-tool result size limits with disk spill, 3-tier context compression.

### Fixed
- Concurrency correctness: budget race condition, `assemble_output` guard against double calls, enforcement assertion for tool classification.

## 2026-04-02

### Added
- **Evidence verification system.** Record-time snippet verification, evidence chain tracking (must read file before citing it), post-investigation verification pass. Prevents hallucinated evidence.
- **Dashboard features.** Context bar, top bar with radar branding, sidebar auto-open.
- **CLI commands.** `analyze` and `compare` extracted to `src/commands/` with full test coverage (23 tests).

### Fixed
- `recordFinding` type cast regression that broke 10 tests and dashboard build.

## 2026-04-01

### Added
- **CI/CD goal type.** `ci-check` with 3 categories (deps, security, config), compact PR comment renderer, GitHub hook integration.
- **JSON export.** `FullExport` schema with complete metadata. CLI `--export` flag.
- **Secret redaction.** AWS access keys, connection strings, Bearer tokens, PEM private keys stripped from tool results before LLM context.
- **Prompt injection defense.** Context boundary wrapping, 12 pattern sanitizers.
- **HTML investigation log.** Collapsible steps with inline scorecard.

## 2026-03-31

### Added
- **Initial release.** Full Phase 1-4 implementation.
- 15 deterministic tools (repo, search, config, dependency, analysis).
- 6 additional tools (web, meta, analysis extensions) completing the 23-tool catalog.
- Consulting rules (11 markdown files) and reference knowledge base.
- Pi Agent integration with goal prompts, output assembler, scorecard computation.
- CLI with `analyze`, `compare`, `tools`, `rules` commands.
- E2e tests against fixture repos.
- Dual-model cost optimization (Sonnet investigates, Haiku writes).
- Portkey AI gateway to Amazon Bedrock.
