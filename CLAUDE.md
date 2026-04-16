# CLAUDE.md

## Project

This is **repo-audit-delivery-agent** — an agentic consulting tool that investigates headless CMS codebases and produces structured, scored delivery outputs.

## Spec

The full implementation spec is in `docs/spec.md`. Read the entire spec before writing any code. It contains the architecture, data models, tool definitions, consulting rules, output schemas, and implementation sequence.

## Implementation order

Follow the phased build order in section 15 of the spec exactly:

1. **Phase 1: Tools** — Implement all deterministic tools first (repo, search, config parsing, dependencies, analysis, web). Each tool is a standalone function with typed inputs and outputs. Unit test each tool against fixture repos before moving on.
2. **Phase 2: Rules + references** — Write the consulting rule markdown files and reference knowledge base files. Implement the rule loader and system prompt assembler.
3. **Phase 3: Agent integration** — Wire tools into Pi Agent, implement goal prompts, output assembler, scorecard computation, and renderers.
4. **Phase 4: CLI + polish** — Build the CLI, investigation log renderer, and run end-to-end against target repos.

Do not skip ahead. Each phase depends on the previous one being solid.

## Key architectural principles

- **Tools are deterministic.** They return facts, never call an LLM, never reason. They are pure functions with typed inputs and outputs.
- **Orchestration is agentic.** The agent (via Pi's `Agent` class) decides which tools to call and in what order. There is no hardcoded pipeline.
- **Rules are plain English markdown.** They go in `src/rules/` and are loaded at runtime. They are not code.
- **References are static knowledge files.** They go in `src/references/` and are loaded selectively by the agent.
- **Outputs follow structured schemas.** The output assembler enforces the schema; the agent writes the narrative content.

## Tech stack

- TypeScript (strict, ESM)
- Node.js 20+
- pnpm (package manager)
- Vitest 3.x (unit + e2e testing)
- Pi Agent (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` v0.64.0) — agent loop, tool calling, event streaming
- Portkey AI gateway (via Pi's `openai-completions` Model with custom `baseUrl` + `headers`) → Amazon Bedrock
- Provider-agnostic model config: `AGENT_MODEL` (main loop) and `FAST_MODEL` (lightweight tasks) in `.env`

## Provider setup

Portkey AI gateway routes to Amazon Bedrock. No virtual key needed — uses base URL + provider header.

Required environment variables (add to `.env`, never commit):

```
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_BASE_URL=https://portkeygateway.example.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
PROVIDER_TYPE=portkey

AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0

# Optional: enable web search (Brave Search API)
# SEARCH_ENGINE=brave
# SEARCH_API_KEY=your-brave-search-api-key

# Optional: enable GitHub issue creation from findings
# GITHUB_TOKEN=ghp_... (needs repo scope)
```

Model IDs are provider-agnostic env vars. `AGENT_MODEL` handles the investigation phase (reasoning, tool selection, evidence gathering). `FAST_MODEL` handles finding recording and brief assembly. Both models are built by `src/config/piModel.ts`. Swap to any provider's model IDs without code changes.

## Dual-model cost optimization

The agent uses an **intent-based model switch** pattern to reduce cost:

1. **Investigation phase** — `AGENT_MODEL` (Sonnet) handles all reasoning: deciding which tools to call, analyzing results, planning next steps.
2. **Agent calls `switch_to_fast_model`** — a tool that signals "I'm done investigating." The runner switches to `FAST_MODEL` (Haiku) by mutating the model object in place (Pi's `_runLoop` captures the model reference once at loop start, so `setModel()` alone doesn't take effect mid-loop — in-place mutation ensures the running loop sees the change).
3. **Writing phase** — `FAST_MODEL` (Haiku) handles recording findings and assembling the brief. Writing is cheaper and Haiku is sufficient.

The switch is **agent-initiated**, not timer-based or budget-based. The agent knows when investigation is complete better than any heuristic. Fallbacks ensure the switch happens even if the agent forgets:
- At 50% budget remaining, a steering message reminds the agent to switch.
- At 5 calls remaining, the runner force-switches to the fast model.
- Post-loop retry nudges also use the fast model.

This pattern was chosen over classifier-based routing (RouteLLM), cascading (FrugalGPT), and per-tool routing after evaluating common multi-model cost optimization approaches. The two-phase structure matches the natural investigate-then-write shape of consulting work.

Verified in Chunk 0 spike (`docs/pi-api-notes.md`):
- Both models connect and respond via Portkey gateway
- Tool calling works (finish reason: `tool_use`)
- Cache tokens not surfaced by Portkey (defaults to 0 in RunMetrics)

## Goal types

Six analysis goals, each with its own rules file and prompt:

| Goal | Rule file | Use case | Output |
|------|-----------|----------|--------|
| `onboarding` | `goal-onboarding.md` | New developer joining project | Full brief with 12 sections |
| `audit` | `goal-audit.md` | Architecture assessment | Scored scorecard + findings |
| `migration` | `goal-migration.md` | Upgrade readiness | Migration hotspots + complexity |
| `component-map` | — | Component inventory | Structured component map |
| `ci-check` | `goal-ci-check.md` | CI health check (fast) | Pass/fail + compact PR comment |
| `security-review` | `goal-security-review.md` | Security audit | 6-category security scorecard |
| `nextjs` | `goal-nextjs.md` | Next.js framework health | 7-category framework scorecard |
| `accessibility` | `goal-accessibility.md` | WCAG 2.1 AA compliance | 6-category a11y scorecard |

`ci-check` is designed for CI pipelines: 15 tool calls max, 3 categories (deps/security/config), compact output via `renderCiComment()` for PR comments.

## CLI

```
radar analyze --repo <path> [--goal <type>] [--platform <name>] [--budget <n>]
              [--output <dir>] [--verbose] [--json] [--export] [--export-pdf]
              [--github-output] [--pr <number>] [--dry-run]
radar compare --repos <path1> <path2> [--goal <type>] [--budget <n>]
radar diff <run-a.json> <run-b.json>
radar tools [--list]
radar rules [--validate]
radar dashboard [--port <port>]
```

Key flags:
- `--json` — Compact CI summary to stdout (status, score, findings count, top risks, ciOperations)
- `--export` — Full `FullExport` JSON to stdout (all findings, investigation log, metrics, sections)
- `--export-pdf` — Generate client-ready PDF report (cover page, exec summary, scorecard, findings)
- CI integration auto-detects platform (GitHub Actions / Azure DevOps) from env vars and runs PR comments, annotations, SARIF, labels, quality gates, and trend tracking automatically

## Testing

Framework: Vitest (unit and e2e)

- **Unit tests** — Every tool gets a happy path + one error case test against `test/fixtures/sitecore-minimal/`
- **E2e tests** — Run the full agent loop against fixture repo, assert:
  - All 12 brief sections populated
  - Scorecard categories scored (red/yellow/green)
  - Findings have evidence, filePath, severity
  - Output files written to disk
  - Use longer Vitest timeout (~60s) since e2e waits on LLM round-trips
- **Manual validation** against two real public repos:
  - `Sitecore/xmcloud-starter-js`
  - `remkoj/optimizely-saas-starter`

## What not to do

- Do not build a fixed pipeline that runs every tool in sequence. The agent decides what to investigate.
- Do not hardcode consulting rules in TypeScript. They are markdown files.
- Do not inline prompt templates as strings in code. They are loaded from files.
- Do not call the LLM from inside tools. Tools are deterministic.
- Do not dump all reference files into context at once. The agent loads them selectively.
- Do not use Anthropic SDK or Portkey SDK directly. Pi's `openai-completions` provider handles HTTP to Portkey gateway. Model config is in `src/config/piModel.ts`.
- Do not hardcode AWS credentials anywhere. They live in `.env`.
- Do not reference specific model names (Sonnet, Haiku) in code. Use role-based env vars (`AGENT_MODEL`, `FAST_MODEL`) via `src/config/piModel.ts`.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
