# Radar

AI-powered repository audit platform that investigates any codebase and produces structured, scored consulting deliverables.

## What it does

Radar is an agentic analysis tool that autonomously investigates repositories — deciding what to look at, gathering evidence, and assembling client-ready reports with architecture scorecards, prioritized findings, and actionable recommendations. It is not a linter or static analysis wrapper. It reasons like a senior consultant, following human-authored rules loaded from markdown files.

The agent supports 10 analysis goals out of the box: architecture audits, security reviews, Next.js health checks, accessibility compliance, performance analysis, migration readiness, onboarding briefs, and more. Goals are stack-agnostic by default, with deep specializations available for headless CMS platforms (Sitecore XM Cloud, Optimizely SaaS CMS).

Point it at any repo — local path or GitHub URL — and get a scored report in under 2 minutes.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) for system design and component map, [CHANGELOG.md](CHANGELOG.md) for release history, [DESIGN.md](DESIGN.md) for the dashboard design system.

## Quick Start

```bash
pnpm install
```

Create a `.env` file with your provider credentials (see [Provider Setup](#provider-setup) below), then run:

```bash
# Architecture audit on any repo
radar analyze --repo <path-or-url> --goal audit-generic

# Security review
radar analyze --repo ../my-app --goal security-review --verbose

# Next.js health check from a GitHub URL
radar analyze --repo https://github.com/org/repo --goal nextjs

# Full onboarding brief (CMS-specialized)
radar analyze --repo ../xmcloud-starter-js --goal onboarding
```

`radar` is aliased to `npx tsx src/index.ts` during development.

## CLI Commands

### `analyze`

Run an agentic investigation on a repository.

```
radar analyze [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <path>` | Repository local path or GitHub URL (required) | -- |
| `--goal <type>` | Analysis goal (see [Goals](#goals)) | `audit-generic` |
| `--platform <name>` | Platform override: `sitecore`, `optimizely` | auto-detected |
| `--budget <n>` | Tool call budget | `45` |
| `--output <dir>` | Output directory | `./output` |
| `--verbose` | Show real-time agent reasoning and tool calls | off |
| `--json` | Output summary as JSON (for CI integration) | off |
| `--export` | Output full JSON export to stdout (all findings, log, metrics, sections) | off |
| `--export-pdf` | Generate client-ready PDF report | off |
| `--github-output` | Post results to GitHub (PR comment for ci-check) | off |
| `--pr <number>` | PR number for ci-check goal comments (or set `GITHUB_PR_NUMBER`) | -- |
| `--resume <path>` | Resume from a checkpoint file (path to `.jsonl`) | -- |
| `--checkpoint-interval <n>` | Save checkpoint every N tool calls (0 to disable) | `5` |
| `--dry-run` | Show configuration without running the agent | off |

### `compare`

Run side-by-side comparison of two repositories. Produces individual briefs and a comparative summary highlighting relative strengths and gaps.

```
radar compare --repos <path1> <path2> [--goal <type>] [--budget <n>]
```

### `diff`

Compare findings between two runs. Matches by fingerprint, falls back to SHA-256 of category+filePath+title.

```
radar diff <run-a.json> <run-b.json>
```

Output shows New, Resolved, and Persistent findings with a summary.

### `tools`

List all registered tools and their parameters.

```
radar tools --list
```

### `rules`

Validate that all expected consulting rule files exist for each goal/platform combination.

```
radar rules --validate
```

### `dashboard`

Launch the web dashboard for browsing runs, replaying agent reasoning, and comparing results.

```
radar dashboard [--port 3000]
```

## Goals

| Goal | Stack | Description |
|------|-------|-------------|
| `audit-generic` | Any | Stack-agnostic architecture assessment across 8 categories |
| `security-review` | Any | Security audit across 6 categories with secrets archaeology and FP exclusion |
| `nextjs` | Next.js | Framework health audit across 7 categories (routing, data fetching, caching, etc.) |
| `accessibility` | Any | WCAG 2.1 AA compliance audit across 6 categories with severity-mapped violations |
| `performance` | Any | Web performance and Core Web Vitals analysis with prioritized findings |
| `ci-check` | Any | Fast CI health check (under 15 tool calls) producing pass/fail for PR gates |
| `migration` | Any | Migration readiness assessment with prioritized hotspots and complexity estimates |
| `component-map` | Any | Structured component inventory with directives and data fetching patterns |
| `audit` | CMS | CMS-specific architecture assessment with weighted scoring rubric |
| `onboarding` | CMS | Full 12-section consultant onboarding brief with scorecard and recommendations |

## Architecture

The system follows a strict separation: **tools are deterministic, orchestration is agentic, rules are human-authored, outputs are structured.**

```
Goal Prompt (any of 10 analysis goals)
    |
    v
+--------------------------------------------------+
|  Pi Agent (observe -> reason -> act)              |
|                                                   |
|  System instructions (consulting rules from .md)  |
|  Reference knowledge (selectively loaded .md)     |
|  Pi AgentTools (23 deterministic functions)       |
|  Working state (findings, file cache, log)        |
+--------------------------------------------------+
    |
    v
Output Assembler -> scorecard + brief + JSON/PDF export
```

- **Tools** -- Pure functions that return facts (file contents, parsed configs, grep results, npm versions). They never call an LLM. Wrapped as Pi `AgentTool[]` with TypeBox schemas. 23 tools total; 3 infrequently-used tools are deferred-loaded via the `tool_search` meta-tool to save context tokens.
- **Rules** -- Plain English markdown files in `src/rules/` that shape the agent's priorities and quality standards. Editable by senior consultants without code changes.
- **References** -- Static knowledge files in `src/references/` (platform best practices, known antipatterns, compatibility matrices) loaded selectively by the agent.
- **Agent loop** -- Pi's `Agent` class handles tool dispatch, message threading, and loop control. `beforeToolCall`/`afterToolCall` hooks enforce budgets. The loop runs until `assemble_output` is called or the budget is spent.
- **Dual-model** -- Investigation phase uses `AGENT_MODEL` (heavy reasoning). The agent calls `switch_to_fast_model` when it decides investigation is complete, switching to `FAST_MODEL` (cheaper, faster) for finding assembly and brief writing. Fallback: force-switch at 5 calls remaining.
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

A Next.js web app for browsing runs, replaying agent reasoning, and comparing results across repos.

- **Live event stream** -- Watch the agent investigate in real time with grouped tool calls and reasoning steps
- **Replay mode** -- Step through completed investigations to understand the agent's decision-making
- **Run history** -- Browse past runs with sidebar navigation, persisted to disk
- **Dark/light/system theme** -- Manual toggle with system preference detection
- **Command palette** -- Keyboard-driven navigation (`Cmd+K` / `Ctrl+K`)

## Provider Setup

Radar is provider-agnostic — it works with any OpenAI-compatible endpoint. Create a `.env` file in the project root:

**Portkey → Bedrock (recommended for production):**

```
PROVIDER_TYPE=portkey
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_BASE_URL=https://portkeygateway.example.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

**OpenAI direct:**

```
PROVIDER_TYPE=openai
OPENAI_API_KEY=sk-...
AGENT_MODEL=gpt-4o
FAST_MODEL=gpt-4o-mini
```

**Any OpenAI-compatible endpoint (Ollama, Together, Groq, vLLM):**

```
PROVIDER_TYPE=generic
GENERIC_BASE_URL=http://localhost:11434/v1
GENERIC_API_KEY=ollama
AGENT_MODEL=llama3.1:70b
FAST_MODEL=llama3.1:8b
```

| Variable | Purpose |
|----------|---------|
| `PROVIDER_TYPE` | Provider type: `portkey`, `openai`, `azure-openai`, `generic` |
| `AGENT_MODEL` | Heavy model for investigation and reasoning (first half of budget) |
| `FAST_MODEL` | Lightweight model for finding assembly and brief writing (second half) |

Model IDs are provider-agnostic env vars. Both models are built by `src/config/piModel.ts`. The agent decides when to switch via the `switch_to_fast_model` tool.

## Output Files

Each run writes to `output/<timestamp>/`:

| File | Contents |
|------|----------|
| `brief.md` | Consulting report (section count varies by goal) |
| `scorecard.json` | Scored categories with red/yellow/green ratings |
| `findings.json` | All findings with evidence, severity, confidence, and fingerprints |
| `export.json` | Complete export: scorecard + findings + stack profile + investigation log |
| `investigation.md` | Step-by-step log of agent reasoning and tool calls |
| `investigation.html` | Browsable HTML investigation log with collapsible steps |
| `report.pdf` | Client-ready PDF (when `--export-pdf` is used) |
| `*-checkpoint.jsonl` | Session checkpoints (append-only, for `--resume`) |
| `session-costs.jsonl` | Cross-run cost tracking (append-only) |

## CI Integration

Radar auto-detects CI platforms from environment variables and runs as a quality gate on every PR — scored comments, file-level annotations, trend tracking, and configurable pass/fail thresholds. One YAML block to set up.

### GitHub Actions Setup

**Step 1: Add secrets.** Go to Settings > Secrets and variables > Actions. Add:

| Secret | Value |
|--------|-------|
| `PORTKEY_API_KEY` | Your Portkey gateway API key |
| `PORTKEY_BASE_URL` | Your Portkey gateway base URL (e.g. `https://portkeygateway.example.com/v1`) |

**Step 2: Add the workflow.** Create `.github/workflows/radar.yml`:

```yaml
name: Radar CI Check

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  radar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g pnpm && pnpm install

      - name: Run Radar
        env:
          PORTKEY_API_KEY: ${{ secrets.PORTKEY_API_KEY }}
          PORTKEY_BASE_URL: ${{ secrets.PORTKEY_BASE_URL }}
          PORTKEY_PROVIDER: '@aws-bedrock-use2'
          PROVIDER_TYPE: portkey
          AGENT_MODEL: us.anthropic.claude-sonnet-4-6
          FAST_MODEL: us.anthropic.claude-haiku-4-5-20251001-v1:0
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: radar analyze --repo . --goal ci-check --json

      - name: Upload findings
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: radar-findings
          path: output/radar-findings.json
          if-no-files-found: ignore
```

That's it. Every PR gets a scorecard comment like this:

```
## 🟢 Radar CI Check: PASS

| Category | Score | Issues | Trend   |
|----------|-------|--------|---------|
| Deps     | GREEN | 2      | -1 resolved |
| Security | YELLOW| 3      | +1 new  |
| Config   | GREEN | 1      | unchanged |

<details><summary>Security (3 findings)</summary>
- **[HIGH] Exposed API key** — `src/config.ts:42`
- **[MEDIUM] Missing CSP header**
- **[MEDIUM] Outdated auth middleware**
</details>
```

**Using the reusable action (Docker).** If you've published the Docker image to GHCR, use the composite action instead:

```yaml
- uses: ./.github/actions/radar
  with:
    portkey-api-key: ${{ secrets.PORTKEY_API_KEY }}
    portkey-base-url: ${{ secrets.PORTKEY_BASE_URL }}
    goal: ci-check          # default
    budget: '15'             # default
    webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}  # optional
```

### Azure DevOps Setup

**Step 1: Create a variable group** (or pipeline variables) with:

| Variable | Value | Secret? |
|----------|-------|---------|
| `PORTKEY_API_KEY` | Your Portkey API key | Yes |
| `PORTKEY_BASE_URL` | Your Portkey base URL | No |

**Step 2: Add to your pipeline.** In `azure-pipelines.yml`:

```yaml
trigger: none

pr:
  branches:
    include:
      - main

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: radar-secrets  # or inline variables

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g pnpm && pnpm install
    displayName: 'Install dependencies'

  - script: radar analyze --repo . --goal ci-check --json
    displayName: 'Run Radar'
    env:
      PORTKEY_API_KEY: $(PORTKEY_API_KEY)
      PORTKEY_BASE_URL: $(PORTKEY_BASE_URL)
      PORTKEY_PROVIDER: '@aws-bedrock-use2'
      PROVIDER_TYPE: portkey
      AGENT_MODEL: us.anthropic.claude-sonnet-4-6
      FAST_MODEL: us.anthropic.claude-haiku-4-5-20251001-v1:0
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)

  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: 'output/radar-findings.json'
      artifactName: 'radar-findings'
    continueOnError: true
```

Radar reads `TF_BUILD`, `SYSTEM_ACCESSTOKEN`, `SYSTEM_PULLREQUEST_PULLREQUESTID`, `SYSTEM_COLLECTIONURI`, and `SYSTEM_TEAMPROJECT` automatically. PR comments appear as thread comments anchored to specific files.

### Platform Detection

| Environment | Detected via | What you get |
|-------------|-------------|-------------|
| GitHub Actions | `GITHUB_ACTIONS=true` | PR comments (update-in-place), check run annotations, SARIF for Code Scanning, artifact management, auto-labels |
| Azure DevOps | `TF_BUILD=True` | PR thread comments, file-anchored annotations, capabilities probe, pipeline artifacts |
| Other / Local | Neither set | Exit code + stdout only (`GenericAdapter`) |

### What Radar Does in CI

On every PR:

1. **Downloads previous findings** from the last run's artifact (if any)
2. **Diffs findings** by fingerprint: classifies each as New, Resolved, or Persistent
3. **Posts a PR comment** with scorecard table, collapsible findings by category, and trend column. Updates the same comment on re-runs (no comment spam)
4. **Adds file annotations** on the PR diff (up to 30, sorted by severity)
5. **Labels the PR** based on finding categories (e.g. `radar:security-review-needed`, `radar:deps-outdated`)
6. **Uploads SARIF** for GitHub Code Scanning (graceful 403 fallback for repos without Advanced Security)
7. **Uploads findings artifact** for the next run's trend tracking
8. **Fires webhook** to Slack/Teams if `WEBHOOK_URL` is set
9. **Evaluates quality gate** and sets exit code

Each operation is logged to `ciOperations` in JSON output. If any operation fails (e.g. no permission to label), it logs the error and continues. Nothing crashes the pipeline.

### Quality Gates

Quality gates are configured in `config/quality-gates.json`:

```json
{
  "failOn": {
    "overallScore": "red",
    "newCriticalFindings": true,
    "newHighFindings": false
  },
  "warnOn": {
    "overallScore": "yellow",
    "newHighFindings": true,
    "regressionCount": 3
  }
}
```

- **`failOn`** matches return exit code 1 (pipeline fails)
- **`warnOn`** matches return exit code 0 with a warning in the PR comment
- Trend-aware: `newCriticalFindings` and `regressionCount` only trigger when there's a previous run to compare against. First run always passes unless the score is red.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Quality gate passed (green/yellow, no new critical findings) |
| `1` | Quality gate failed (red score or new critical findings) |
| `2` | Agent error (LLM connection failure, partial output may exist) |

### Configuring Goals for CI

| Goal | Budget | Use case | Cost |
|------|--------|----------|------|
| `ci-check` | 15 | Fast smoke test (deps, security, config) | ~$0.25 |
| `security-review` | 30 | Deep security audit on security-sensitive PRs | ~$0.50 |
| `nextjs` | 30 | Next.js framework health on frontend PRs | ~$0.50 |
| `audit` | 45 | Full architecture assessment (weekly scheduled) | ~$0.75 |

Run different goals on different triggers:

```yaml
# Fast check on every PR
- name: Quick check
  if: github.event_name == 'pull_request'
  run: radar analyze --repo . --goal ci-check --json

# Deep security review on PRs touching auth/
- name: Security review
  if: contains(github.event.pull_request.changed_files, 'auth/')
  run: radar analyze --repo . --goal security-review --budget 30 --json
```

### Webhook Notifications

Set `WEBHOOK_URL` to a Slack or Teams incoming webhook URL. Radar sends a fire-and-forget POST with:

```json
{
  "text": "Radar CI: GREEN — 6 findings (1 new, 2 resolved) on my-repo",
  "repo": "my-repo",
  "score": "green",
  "findings": 6,
  "newFindings": 1,
  "resolvedFindings": 2,
  "durationMs": 45000,
  "estimatedCostUsd": 0.38
}
```

Webhook URLs are validated against the domain blocklist (blocks localhost, private IPs, AWS metadata) before sending.

### Comparing Runs Locally

Use `radar diff` to compare any two findings exports:

```bash
radar diff output/run-a/findings.json output/run-b/findings.json
```

Output:

```
  Previous: 8 findings
  Current:  6 findings
  Summary:  +1 new, -3 resolved, 5 persistent

  New:
    + [MEDIUM] Missing rate limiting on API endpoint

  Resolved:
    - [HIGH] Exposed API key in config
    - [MEDIUM] Outdated React version
    - [LOW] Missing alt text on logo
```

### Docker

A multi-stage Docker image (`node:20-slim`) is published to GHCR on each release tag:

```bash
docker run --rm \
  -e PROVIDER_TYPE -e AGENT_MODEL -e FAST_MODEL \
  -e PORTKEY_API_KEY -e PORTKEY_BASE_URL -e PORTKEY_PROVIDER \
  -v "$(pwd):/repo:ro" \
  ghcr.io/aberhamm/radar:latest \
  analyze --repo /repo --goal audit-generic --json
```

The image includes all rules, references, and the quality gate config. No additional setup needed.

### Required Permissions

**GitHub Actions:**

```yaml
permissions:
  contents: read          # checkout
  pull-requests: write    # PR comments, labels
  checks: write           # check run annotations
  # security-events: write  # optional, for SARIF upload (requires GitHub Advanced Security)
```

**Azure DevOps:**
- `$(System.AccessToken)` needs "Contribute to pull requests" permission
- Build service account needs read access to pipeline artifacts

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
