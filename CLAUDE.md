# CLAUDE.md

## Project

This is **repo-audit-delivery-agent** — an agentic consulting tool that investigates headless CMS codebases and produces structured, scored delivery outputs.

## Spec

The full implementation spec is in `docs/spec.md`. Read the entire spec before writing any code. It contains the architecture, data models, tool definitions, consulting rules, output schemas, and implementation sequence.

## Implementation order

Follow the phased build order in section 15 of the spec exactly:

1. **Phase 1: Tools** — Implement all deterministic tools first (repo, search, config parsing, dependencies, analysis, web). Each tool is a standalone function with typed inputs and outputs. Unit test each tool against fixture repos before moving on.
2. **Phase 2: Rules + references** — Write the consulting rule markdown files and reference knowledge base files. Implement the rule loader and system prompt assembler.
3. **Phase 3: Agent integration** — Wire tools into Pi, implement goal prompts, provider abstraction, output assembler, scorecard computation, and renderers.
4. **Phase 4: CLI + polish** — Build the CLI, investigation log renderer, and run end-to-end against target repos.

Do not skip ahead. Each phase depends on the previous one being solid.

## Key architectural principles

- **Tools are deterministic.** They return facts, never call an LLM, never reason. They are pure functions with typed inputs and outputs.
- **Orchestration is agentic.** The agent (via Pi) decides which tools to call and in what order. There is no hardcoded pipeline.
- **Rules are plain English markdown.** They go in `src/rules/` and are loaded at runtime. They are not code.
- **References are static knowledge files.** They go in `src/references/` and are loaded selectively by the agent.
- **Outputs follow structured schemas.** The output assembler enforces the schema; the agent writes the narrative content.

## Tech stack

- TypeScript
- Node.js
- Pi (agent runtime — tool registration, agent loop, system prompts)
- Portkey AI gateway (`portkey-ai` npm package) → Amazon Bedrock (Claude Sonnet) for the LLM provider (v1)

## Provider setup

The v1 provider uses Portkey as an AI gateway routing to Amazon Bedrock.

Required environment variables (add to `.env`, never commit):

```
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_VIRTUAL_KEY=your-bedrock-virtual-key
```

Setup:

1. Sign up at portkey.ai, get an API key
2. In Portkey dashboard: Virtual Keys → Create → Select "Bedrock" → Enter AWS Access Key ID, Secret Access Key, Region
3. Ensure Claude models are enabled in your AWS Bedrock console

The Portkey SDK (`portkey-ai`) provides an OpenAI-compatible client. Use Bedrock model IDs like `us.anthropic.claude-sonnet-4-20250514-v1:0`, not Anthropic-format IDs. See section 14 of the spec for full details.

## Testing

- Every tool gets a unit test with a minimal fixture repo in `test/fixtures/`
- Integration tests run the full agent against fixture repos
- Test against two real public repos for validation:
  - `Sitecore/xmcloud-starter-js`
  - `remkoj/optimizely-saas-starter`

## What not to do

- Do not build a fixed pipeline that runs every tool in sequence. The agent decides what to investigate.
- Do not hardcode consulting rules in TypeScript. They are markdown files.
- Do not inline prompt templates as strings in code. They are loaded from files.
- Do not call the LLM from inside tools. Tools are deterministic.
- Do not dump all reference files into context at once. The agent loads them selectively.
- Do not use Anthropic SDK directly. Use the Portkey SDK (`portkey-ai`). It provides the same OpenAI-compatible interface but routes through our gateway to Bedrock.
- Do not hardcode AWS credentials anywhere. They live in the Portkey virtual key and `.env` file.

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
