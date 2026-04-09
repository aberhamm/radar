# Architecture

## Core Principle

**Tools are deterministic. Orchestration is agentic. Rules are human-authored. Outputs are structured.**

No hardcoded pipeline. The LLM agent decides what to investigate and in what order, using 23 deterministic tools that return facts. Consulting rules and reference knowledge are plain English markdown loaded at runtime. The output assembler enforces the schema; the agent writes the narrative.

## System Diagram

```
                         ┌─────────────────┐
                         │   CLI (index.ts) │
                         │   Commander.js   │
                         └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
               ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
               │ analyze │  │ compare │  │  diff   │
               └────┬────┘  └────┬────┘  └─────────┘
                    │             │
                    ▼             ▼
           ┌────────────────────────────┐
           │     Agent Runner           │
           │  (src/agent/runner.ts)     │
           │                            │
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

## Data Flow

### Investigation Phase

1. CLI parses args, resolves repo path (local or clone)
2. `buildSystemPrompt()` loads rules + references for the goal/platform
3. `buildGoalPrompt()` creates the investigation prompt
4. Pi Agent loop starts with `AGENT_MODEL` (Sonnet)
5. Agent calls tools, accumulates findings in `AgentState`
6. Agent calls `switch_to_fast_model` when investigation is complete
7. Snip boundary activates: context compression drops to 40-80 chars
8. `FAST_MODEL` (Haiku) records findings and calls `assemble_output`

### Post-Analysis

1. Evidence verification pass (deterministic, no LLM cost)
2. Scorecard computation from verified findings
3. Brief, JSON export, SARIF, HTML log written to disk
4. `detectCiPlatform()` checks environment variables
5. `orchestrateCi()` runs: artifact download, diff, comment, annotations, labels, SARIF upload, artifact upload, webhook, quality gate
6. Exit code from quality gate evaluation (0 = pass, 1 = fail, 2 = error)

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
