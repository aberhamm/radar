# CLAUDE.md

## Project

This is **repo-audit-delivery-agent** — an agentic consulting tool that investigates headless CMS codebases and produces structured, scored delivery outputs.

## Spec

The full implementation spec is in `docs/spec.md`. Read the entire spec before writing any code. It contains the architecture, data models, tool definitions, consulting rules, output schemas, and implementation sequence.

## Implementation order

Follow the phased build order in section 15 of the spec exactly:

1. **Phase 1: Tools** — Implement all deterministic tools first (repo, search, config parsing, dependencies, analysis, web). Each tool is a standalone function with typed inputs and outputs. Unit test each tool against fixture repos before moving on.
2. **Phase 2: Rules + references** — Write the consulting rule markdown files and reference knowledge base files. Implement the rule loader and system prompt assembler.
3. **Phase 3: Agent integration** — Wire tools into DirectLoopRunner, implement goal prompts, provider abstraction, output assembler, scorecard computation, and renderers.
4. **Phase 4: CLI + polish** — Build the CLI, investigation log renderer, and run end-to-end against target repos.

Do not skip ahead. Each phase depends on the previous one being solid.

## Key architectural principles

- **Tools are deterministic.** They return facts, never call an LLM, never reason. They are pure functions with typed inputs and outputs.
- **Orchestration is agentic.** The agent (via DirectLoopRunner) decides which tools to call and in what order. There is no hardcoded pipeline.
- **Rules are plain English markdown.** They go in `src/rules/` and are loaded at runtime. They are not code.
- **References are static knowledge files.** They go in `src/references/` and are loaded selectively by the agent.
- **Outputs follow structured schemas.** The output assembler enforces the schema; the agent writes the narrative content.

## Tech stack

- TypeScript (strict, ESM)
- Node.js 20+
- pnpm (package manager)
- Vitest 3.x (unit + e2e testing)
- DirectLoopRunner (manual tool-calling loop — Pi not yet available as npm package, see `docs/pi-api-notes.md`)
- Portkey AI gateway (`portkey-ai` npm package) → Amazon Bedrock
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
```

Model IDs are provider-agnostic env vars. `AGENT_MODEL` handles investigation, reasoning, and tool selection. `FAST_MODEL` handles file triage, narrative generation, and finding dedup. Swap to any provider's model IDs without code changes.

Verified in Chunk 0 spike (`docs/pi-api-notes.md`):
- Both models connect and respond via Portkey gateway
- Tool calling works (finish reason: `tool_use`)
- Cache tokens not surfaced by Portkey (defaults to 0 in RunMetrics)

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
- Do not use Anthropic SDK directly. Use the Portkey SDK (`portkey-ai`). It provides the same OpenAI-compatible interface but routes through our gateway to Bedrock.
- Do not hardcode AWS credentials anywhere. They live in `.env`.
- Do not reference specific model names (Sonnet, Haiku) in code. Use role-based names (`agent`, `fast`) from `src/config/models.ts`.

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
