# repo-audit-delivery-agent

Agentic consulting tool for headless CMS codebase analysis.

## What it does

repo-audit-delivery-agent investigates headless CMS codebases (Sitecore XM Cloud/JSS and Optimizely SaaS CMS, both with Next.js) and produces structured, scored onboarding briefs. The agent autonomously decides what to investigate using deterministic tools, records findings with file-level evidence, and assembles a 12-section consulting deliverable with an architecture scorecard. It is not a linter or static analysis wrapper -- it reasons like a senior consultant, following human-authored rules loaded from markdown files.

## Quick Start

```bash
pnpm install
```

Create a `.env` file with your provider credentials (see [Provider Setup](#provider-setup) below), then run:

```bash
npx tsx src/index.ts analyze --repo <path-or-url> --goal onboarding
```

Example against a local repo:

```bash
npx tsx src/index.ts analyze --repo ../xmcloud-starter-js --goal onboarding --verbose
```

Example against a GitHub repo:

```bash
npx tsx src/index.ts analyze --repo https://github.com/Sitecore/xmcloud-starter-js --goal onboarding
```

## CLI Commands

### `analyze`

Run an agentic investigation on a repository.

```
npx tsx src/index.ts analyze [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <path>` | Repository local path or GitHub URL (required) | -- |
| `--goal <type>` | Analysis goal (see [Goals](#goals)) | `onboarding` |
| `--platform <name>` | Platform override: `sitecore`, `optimizely` | auto-detected |
| `--budget <n>` | Tool call budget | `50` |
| `--output <dir>` | Output directory | `./output` |
| `--verbose` | Show real-time agent reasoning and tool calls | off |
| `--json` | Output summary as JSON (for CI integration) | off |
| `--dry-run` | Show configuration without running the agent | off |

### `tools`

List all registered tools and their parameters.

```
npx tsx src/index.ts tools --list
```

### `rules`

Validate that all expected consulting rule files exist for each goal/platform combination.

```
npx tsx src/index.ts rules --validate
```

## Goals

| Goal | Description |
|------|-------------|
| `onboarding` | Full 12-section consultant onboarding brief with scorecard, risks, and recommendations |
| `audit` | Scored architecture audit with findings across all scorecard categories |
| `migration` | Migration readiness assessment with prioritized hotspots and complexity estimates |
| `component-map` | Structured component inventory showing CMS bindings, directives, and data fetching |
| `ci-check` | Fast CI health check (under 15 tool calls) producing pass/fail with blocking issues |

## Architecture

The system follows a strict separation: **tools are deterministic, orchestration is agentic, rules are human-authored, outputs are structured.**

```
Goal Prompt
    |
    v
+--------------------------------------------------+
|  Pi Agent (observe -> reason -> act)              |
|                                                   |
|  System instructions (consulting rules from .md)  |
|  Reference knowledge (platform-specific .md)      |
|  Pi AgentTools (20 deterministic functions)       |
|  Working state (findings, file cache, log)        |
+--------------------------------------------------+
    |
    v
Output Assembler -> scorecard + brief + JSON export
```

- **Tools** -- Pure functions that return facts (file contents, parsed configs, grep results, npm versions). They never call an LLM. Wrapped as Pi `AgentTool[]` with TypeBox schemas.
- **Rules** -- Plain English markdown files in `src/rules/` that shape the agent's priorities and quality standards. Editable by senior consultants without code changes.
- **References** -- Static knowledge files in `src/references/` (platform best practices, known antipatterns, compatibility matrices) loaded selectively by the agent.
- **Agent loop** -- Pi's `Agent` class handles tool dispatch, message threading, and loop control. `beforeToolCall`/`afterToolCall` hooks enforce budgets. The loop runs until `assemble_output` is called or the budget is spent.
- **Gateway** -- Portkey AI gateway routes to Amazon Bedrock via Pi's `openai-completions` Model with custom headers.
- **Output pipeline** -- Scorecard computation from findings, markdown brief rendering, and full JSON export.

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
| `record_finding` | Record an investigation finding with category, severity, and evidence |
| `web_search` | Search the web for documentation and known issues |
| `fetch_url` | Fetch and extract text content from a documentation URL |
| `assemble_output` | Signal the agent to assemble the final deliverable from accumulated findings |

## Provider Setup

The agent uses the Portkey AI gateway to route requests to Amazon Bedrock. Create a `.env` file in the project root:

```
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_BASE_URL=https://portkeygateway.example.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
PROVIDER_TYPE=portkey

AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

| Variable | Purpose |
|----------|---------|
| `PORTKEY_API_KEY` | Portkey gateway API key |
| `PORTKEY_BASE_URL` | Portkey gateway base URL |
| `PORTKEY_PROVIDER` | Portkey provider routing header (e.g. `@aws-bedrock-use2`) |
| `PROVIDER_TYPE` | Provider type (`portkey` for production) |
| `AGENT_MODEL` | Model for investigation, reasoning, and tool selection |
| `FAST_MODEL` | Model for file triage, narrative generation, and finding dedup |

Model IDs are provider-agnostic. Swap to any provider's model IDs without code changes.

## Output Files

Each run writes to `output/<timestamp>/`:

| File | Contents |
|------|----------|
| `brief.md` | Full consulting brief with all 12 sections |
| `scorecard.json` | Architecture scorecard with per-category scores (red/yellow/green) |
| `findings.json` | All recorded findings with evidence, severity, and categories |
| `export.json` | Complete export: scorecard + findings + stack profile + investigation log |
| `investigation.md` | Step-by-step log of agent reasoning and tool calls |

The onboarding brief includes these sections: Project Overview, Stack & Architecture, Key Files, CMS Integration, Preview & Editing, Configuration & Environment, Local Development Setup, Architecture Scorecard, Top Risks, First Week Reading List, Questions for the Client, and Suggested Next Actions.

## CI Integration

Use `--json` to get machine-readable output on stdout:

```bash
npx tsx src/index.ts analyze --repo . --goal ci-check --json
```

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | All scorecard categories are green or yellow |
| `1` | At least one scorecard category is red |
| `2` | Agent error (partial output may be written) |

The JSON output includes status, overall score, finding count, tool call count, duration, estimated cost, per-category scores, and top risks.

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
  tools/
    piToolAdapter.ts    All 20 tools as Pi AgentTool[] with TypeBox schemas
    repo/               list_directory, read_file, read_files_batch
    search/             grep_pattern, find_files
    config/             parse_package_json, parse_next_config, parse_tsconfig, parse_env_file, check_gitignore
    dependency/         compare_versions, query_npm_versions
    analysis/           analyze_route_structure, analyze_component_directives, analyze_env_usage, analyze_middleware, record_finding
    web/                web_search, fetch_url
  rules/                Consulting rules (markdown)
    core.md             Shared investigation rules
    goal-onboarding.md  Onboarding brief requirements
    goal-audit.md       Audit scoring criteria
    goal-migration.md   Migration assessment rules
    platform-sitecore.md    Sitecore-specific investigation rules
    platform-optimizely.md  Optimizely-specific investigation rules
  references/           Static knowledge base (markdown)
    consulting/         Quality bar, risk severity guide, client question patterns
    sitecore/           XM Cloud architecture, JSS compatibility, editing patterns, antipatterns
    optimizely/         Content Graph setup, Visual Builder, SDK compatibility, antipatterns
    nextjs/             App Router migration, caching, server components, security headers
  output/
    scorecard.ts        Scorecard computation from findings
    brief.ts            Markdown brief renderer
    json.ts             Full JSON export builder
  config/
    piModel.ts          Pi Model builder (env vars -> Model<'openai-completions'>)
    models.ts           Role-based model config (agent, fast)
    model-pricing.json  Per-model token pricing for cost estimates
  types/
    state.ts            AgentState, Finding, GoalType, StackProfile
    output.ts           Scorecard, RunMetrics
docs/
  spec.md               Full implementation spec
  designs/              Design documents and plans
test/
  fixtures/             Test fixture repos (sitecore-minimal)
  tools/                Unit tests per tool
  e2e/                  End-to-end agent loop tests
```

## License

ISC
