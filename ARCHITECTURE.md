# Architecture

## Core Principle

**Tools are deterministic. Orchestration is agentic. Rules are human-authored. Outputs are structured.**

No hardcoded pipeline. The LLM agent decides what to investigate and in what order, using 23 deterministic tools that return facts. Consulting rules and reference knowledge are plain English markdown loaded at runtime. The output assembler enforces the schema; the agent writes the narrative.

## System Diagram

```
  ┌─────────────────┐                ┌────────────────────────┐
  │   CLI (index.ts) │                │  Dashboard (Next.js)   │
  │   Commander.js   │                │  dashboard/            │
  └────────┬────────┘                └───────────┬────────────┘
           │                                     │
  ┌────────┼────────┐            ┌───────────────┼───────────────┐
  │        │        │            │               │               │
┌─┴──────┐┌┴──────┐┌┴─────┐  ┌──┴─────┐  ┌──────┴─────┐  ┌─────┴──────┐
│analyze ││compare││ diff │  │POST    │  │GET /api/   │  │GET /api/   │
│        ││       ││      │  │/api/run│  │events (SSE)│  │compare     │
└───┬────┘└───┬───┘└──────┘  └───┬────┘  └──────┬─────┘  └────────────┘
    │         │                  │               │
    └─────────┼──────────────────┘               │
              ▼                                  │
     ┌────────────────────────────┐              │
     │     Agent Runner           │◄─────────────┘
     │  (src/agent/runner.ts)     │    SSE streams events
     │                            │    back to browser
     │  Pi Agent loop:            │
     │   observe → reason → act   │
     │                            │
     │  ┌──────────────────────┐  │
     │  │ System Prompt        │  │
     │  │  (rules/*.md)        │  │
     │  │  (references/*.md)   │  │
     │  └──────────────────────┘  │
     │                            │
     │  ┌──────────────────────┐  │
     │  │ 23 AgentTools        │  │
     │  │  repo/search/config  │  │
     │  │  dependency/analysis │  │
     │  │  web/meta            │  │
     │  └──────────────────────┘  │
     │                            │
     │  ┌──────────────────────┐  │
     │  │ AgentState           │  │
     │  │  findings, fileCache │  │
     │  │  investigationLog    │  │
     │  │  modelUsage          │  │
     │  └──────────────────────┘  │
     └────────────┬───────────────┘
                  │
     ┌────────────┼────────────┐
     │            │            │
┌────┴────┐  ┌────┴────┐  ┌───┴───┐
│Scorecard│  │  Brief  │  │  JSON │
│  .json  │  │  .md    │  │Export │
└─────────┘  └─────────┘  └───┬───┘
                               │
                    ┌──────────┴──────────┐
                    │  CI Orchestrator    │
                    │  (src/ci/)          │
                    │                     │
                    │  PR comment         │
                    │  Annotations        │
                    │  SARIF upload       │
                    │  Labels             │
                    │  Artifact upload    │
                    │  Webhook            │
                    │  Quality gate       │
                    └─────────────────────┘
```

## Component Map

### Agent (`src/agent/`)

| File | Purpose |
|------|---------|
| `runner.ts` | Creates Pi Agent, wires hooks, runs the loop, assembles output post-run |
| `goalPrompts.ts` | Goal-specific prompt templates (one per goal type) |
| `systemPrompt.ts` | Loads rules + references into the system prompt |
| `retry.ts` | Per-error-type retry tiers (429: 8 attempts, 529: 3, 502/503: 5, connection: 5) |
| `contextBoundary.ts` | Prompt injection defense (boundary wrapping, 12 pattern sanitizers) |
| `redaction.ts` | Secret redaction (AWS keys, connection strings, Bearer tokens, PEM keys) |

### Tools (`src/tools/`)

23 deterministic tools. Never call an LLM. Wrapped as Pi `AgentTool[]` with TypeBox schemas.

| Category | Tools | Notes |
|----------|-------|-------|
| `repo/` | list_directory, read_file, read_files_batch | Binary detection, ENOENT suggestions, dedup cache |
| `search/` | grep_pattern, find_files | Ripgrep with Node.js fallback, multiline, pagination |
| `config/` | parse_package_json, parse_next_config, parse_tsconfig, parse_env_file, check_gitignore | Never expose env values |
| `dependency/` | compare_versions, query_npm_versions | 24h cache, semver drift classification |
| `analysis/` | analyze_route_structure, analyze_component_directives, analyze_env_usage, analyze_middleware, detect_app_roots, record_finding | record_finding includes evidence verification + fingerprinting |
| `web/` | web_search, fetch_url | LRU cache, domain blocklist, redirect safety, 10MB cap |
| `meta/` | switch_to_fast_model, assemble_output, tool_search | Deferred tool loading for context savings |

**Concurrency model:** Pi fires tool calls in parallel batches. Read-only tools (20 of 23) run fully parallel. Stateful tools (record_finding, assemble_output, switch_to_fast_model) serialize via `StatefulToolMutex`, a lock-free promise chain.

### Rules (`src/rules/`)

Plain English markdown. 11 files. Editable by senior consultants without code changes.

- `core.md` -- shared investigation rules + confidence calibration scale
- `goal-*.md` -- one per goal type (onboarding, audit, migration, ci-check, security-review, nextjs, accessibility, component-map)
- `platform-*.md` -- platform-specific rules (sitecore, optimizely)

### References (`src/references/`)

Static knowledge base loaded selectively by the agent.

- `consulting/` -- quality bar, risk severity guide, client question patterns
- `sitecore/` -- XM Cloud architecture, JSS compatibility, editing patterns
- `optimizely/` -- Content Graph, Visual Builder, SDK compatibility
- `nextjs/` -- App Router migration, caching, server components, security headers

### CI (`src/ci/`)

CI platform integration. Auto-detects environment, runs post-analysis.

| File | Purpose |
|------|---------|
| `adapter.ts` | `CiPlatformAdapter` interface, `detectCiPlatform()` factory, `GenericAdapter` fallback |
| `github.ts` | GitHub Actions adapter (REST API, check runs, SARIF, artifacts, labels) |
| `azureDevops.ts` | Azure DevOps adapter (PR threads, file-anchored annotations, pipeline artifacts) |
| `orchestrator.ts` | `orchestrateCi()` -- runs all CI operations post-analysis, logs each to `CiOperationsLog` |
| `qualityGate.ts` | Evaluates fail/warn thresholds from `config/quality-gates.json` |
| `webhook.ts` | Fire-and-forget POST for Slack/Teams with SSRF protection |
| `utils.ts` | `ciApiFetch<T>()`, `maskToken()`, `deriveLabels()` |

### Output (`src/output/`)

| File | Purpose |
|------|---------|
| `scorecard.ts` | Scorecard computation from findings (confidence-gated, excludes <= 2) |
| `brief.ts` | Markdown brief renderer (confidence badges, low-confidence appendix) |
| `json.ts` | Full JSON export (scorecard + findings + stack profile + investigation log) |
| `ciComment.ts` | PR comment renderer (collapsible findings, trend column, 60K truncation) |
| `sarif.ts` | SARIF 2.1.0 generator (severity mapping, fingerprint support) |
| `investigationHtml.ts` | Static HTML investigation log with collapsible steps |
| `sessionCosts.ts` | Cross-run cost persistence (JSONL append) |
| `sessionCheckpoint.ts` | Checkpoint save/load with Set/Map serialization |

### Dashboard (`dashboard/`) — Optional

Web UI for running analyses, viewing results, and comparing runs. Built with Next.js (App Router). Not required — the CLI is the primary interface. The agent runner is loaded at runtime via `tsx` to bypass webpack (the agent source tree is too heavy for bundling).

#### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/run` | POST | Starts an analysis. Loads `src/agent/runner.ts` via tsx, runs async, streams events via SSE |
| `/api/events` | GET | SSE endpoint. Replays accumulated events on reconnect, then streams new ones |
| `/api/session` | GET | Returns session state (status, history, current run, result) |
| `/api/session` | DELETE | Aborts current run, closes SSE stream, resets session |
| `/api/clone` | POST | Shallow-clones a GitHub repo to `.repos/` (or pulls if cached) |
| `/api/compare` | GET | Diffs two completed runs by fingerprint (new/resolved/persistent findings) |
| `/api/history/[id]` | GET | Loads a specific historical run with events and result |
| `/api/extend-budget` | POST | Resolves the budget-pause promise (extend or wrap up) |
| `/api/rules` | GET | Returns available rules for the UI |

#### Key UI Components

| Component | Purpose |
|-----------|---------|
| `IdleView` | Repo input form (local path or GitHub URL), goal selector |
| `AnalysisView` | Live tool-call stream, findings counter, phase indicator |
| `CompleteView` | Scorecard, brief markdown, findings list, export options |
| `CompareView` | Side-by-side run comparison with finding diff |
| `Sidebar` | Run history, compare mode selection |
| `ContextBar` | Status bar with budget controls, run info |
| `CommandPalette` | Keyboard-driven command palette (Cmd+K) |

#### Session & Persistence

- **In-memory session** via `globalThis.__agentSession` (survives Next.js hot reloads in dev)
- **Disk persistence** to `output/runs/*.json` — completed runs saved as JSON, in-progress runs checkpointed every 10 events
- **Lazy event loading** — history list loads metadata only; events loaded on demand from disk

#### SSE Streaming Architecture

The dashboard streams agent progress to the browser in real-time:

1. `POST /api/run` starts the agent async and returns immediately
2. Browser connects to `GET /api/events` (SSE)
3. Agent runner calls `onStep()` callback for each event
4. Callback pushes events to the SSE `ReadableStream` controller
5. Transient events (`text_delta`, `tool_start`) are streamed but not persisted
6. On reconnect, accumulated events are replayed before streaming new ones
7. Budget exhaustion pauses the agent via a `Promise` — UI shows extend/wrap-up controls

## Data Flow

### Investigation Phase (CLI)

1. CLI parses args, resolves repo path (local or clone)
2. `buildSystemPrompt()` loads rules + references for the goal/platform
3. `buildGoalPrompt()` creates the investigation prompt
4. Pi Agent loop starts with `AGENT_MODEL` (Sonnet)
5. Agent calls tools, accumulates findings in `AgentState`
6. Agent calls `switch_to_fast_model` when investigation is complete
7. Snip boundary activates: context compression drops to 40-80 chars
8. `FAST_MODEL` (Haiku) records findings and calls `assemble_output`

### Investigation Phase (Dashboard)

1. User submits repo path or GitHub URL via `IdleView`
2. For GitHub URLs: `POST /api/clone` shallow-clones to `.repos/`
3. `POST /api/run` claims the session, loads `runner.ts` via tsx, starts agent async
4. Browser opens `GET /api/events` SSE connection
5. Each tool call, text delta, and finding fires `onStep()` → SSE stream → browser
6. `useLiveAnalysis()` hook derives UI state (phases, findings, progress) from events
7. Budget exhaustion pauses the agent; UI shows extend/wrap-up; `POST /api/extend-budget` resolves
8. On completion, run is persisted to `output/runs/` and added to session history

### Post-Analysis

1. Evidence verification pass (deterministic, no LLM cost)
2. Scorecard computation from verified findings
3. Brief, JSON export, SARIF, HTML log written to disk
4. **CLI path:** `detectCiPlatform()` checks environment variables; `orchestrateCi()` runs: artifact download, diff, comment, annotations, labels, SARIF upload, artifact upload, webhook, quality gate; exit code from quality gate evaluation (0 = pass, 1 = fail, 2 = error)
5. **Dashboard path:** `CompleteView` renders scorecard, brief, and findings; users can export, compare runs, or start a new analysis

## Key Design Decisions

### Dual-Model Cost Optimization

Investigation runs on Sonnet (~$3/M input). Writing runs on Haiku (~$0.25/M input). The agent decides when to switch via `switch_to_fast_model`, not a timer or budget threshold. Saves ~37% vs Sonnet-only. The snip boundary adds another ~60% context reduction for the writing phase. Typical 45-call run: under $0.75.

### Fingerprint-Based Trend Tracking

No database needed. Each finding gets `SHA-256(category + filePath + normalizedTitle)`. Diff two JSON exports by fingerprint set intersection. New = only in current. Resolved = only in previous. Persistent = in both.

### Evidence Verification

LLMs fabricate code snippets after many tool calls push the original read out of context. Every finding's evidence is verified against the actual file at record time and again post-loop. Mismatches auto-correct. Unverifiable findings are dropped before scoring.

### CI Adapter Pattern

Native `fetch()` everywhere, no CLI dependencies. Each platform adapter implements the same interface. The orchestrator doesn't know which platform it's talking to. `GenericAdapter` is a no-op fallback for local runs. Failures are rescued and logged, never crash the run.

## External Dependencies

| Dependency | Purpose | Why this one |
|------------|---------|-------------|
| Pi Agent (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`) | Agent loop, tool dispatch | Lightweight, TypeScript-native, parallel tool execution |
| Commander | CLI parsing | Standard, zero-config |
| Turndown | HTML-to-Markdown conversion | Preserves structure for `fetch_url` results |
| Portkey AI Gateway | Routes to Amazon Bedrock | Provider-agnostic routing, no AWS SDK needed |
| Next.js (App Router) | Dashboard web UI | SSE streaming, API routes, optional — not required for CLI usage |
