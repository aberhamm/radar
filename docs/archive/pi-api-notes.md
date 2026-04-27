# Pi + Portkey Integration Notes

Date: 2026-04-01 (updated from 2026-03-31 spike)

## Pi Agent Integration

**Result: Pi IS available and integrated.**

The March 31 spike searched for `@anthropic-ai/pi` and `pi-agent` (wrong packages). The correct packages are:
- `@mariozechner/pi-agent-core` (v0.64.0)
- `@mariozechner/pi-ai` (v0.64.0)

Published at https://github.com/badlogic/pi-mono/

### Architecture

Pi's `Agent` class replaces the hand-rolled `DirectLoopRunner`. Key integration points:

| Component | Implementation |
|-----------|---------------|
| Model config | `src/config/piModel.ts` — builds `Model<'openai-completions'>` from env vars |
| Tool adapter | `src/tools/piToolAdapter.ts` — all 20 tools as Pi `AgentTool[]` with TypeBox schemas |
| Stub testing | Pi's native `registerFauxProvider` — scripted responses via `fauxAssistantMessage`/`fauxToolCall` |
| Runner | `src/agent/runner.ts` — creates Pi Agent, uses `beforeToolCall`/`afterToolCall` hooks |

### Key Technical Details

**Model config for Portkey**: Pi's `openai-completions` provider sends API key as `Authorization: Bearer` header. Portkey needs this. Solution: pass `getApiKey: async () => apiKey` to Agent constructor.

```typescript
const piModel: Model<'openai-completions'> = {
  id: modelId,
  api: 'openai-completions',
  provider: 'portkey',
  baseUrl,
  headers: {
    'x-portkey-api-key': apiKey,
    'x-portkey-provider': provider,
  },
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStore: false,
    maxTokensField: 'max_tokens',
  },
  // ...
};
```

**assemble_output handling**: Executes as a normal AgentTool (stores sections in closure ref), then `afterToolCall` calls `agent.abort()` to stop the loop.

**Dual-model**: Investigation runs on `AGENT_MODEL` (heavy). At the budget midpoint, `afterToolCall` switches to `FAST_MODEL` (cheap) via `agent.setModel()` for finding assembly and brief writing.

**Budget enforcement**: `beforeToolCall` checks tool call count and blocks when exhausted (optionally extending via `onBudgetExhausted` callback). `afterToolCall` injects steering messages at budget/2 and 5 remaining calls.

**Cost controls**: Tool results capped at 4K chars in piToolAdapter. `transformContext` prunes old tool results to 200 chars (keeps last 10 messages intact). `onPayload` injects `cache_control: ephemeral` breakpoints on the system prompt for Anthropic prompt caching via Portkey.

**Stub testing**: Pi's native `registerFauxProvider` + `fauxAssistantMessage`/`fauxToolCall` provide scripted LLM responses for e2e tests. No custom adapter needed.

## Portkey + Bedrock Verification

**Result: All checks pass.**

### Gateway setup

- **Gateway**: `portkeygateway.perficient.com/v1`
- **Provider routing**: `x-portkey-provider: @aws-bedrock-use2` header
- **Auth**: `PORTKEY_API_KEY` passed via Pi's `getApiKey` callback (Bearer token)

### Model IDs (verified working)

| Model | Bedrock ID | Use |
|-------|-----------|-----|
| Sonnet 4.6 | `us.anthropic.claude-sonnet-4-6` | Investigation phase (first half of budget: reasoning, tool selection) |
| Haiku 4.5 | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Assembly phase (second half of budget: findings, brief writing) |

### Token usage

Standard `prompt_tokens` and `completion_tokens` are returned. **Cache tokens: NOT surfaced** by Portkey. `cachedTokens` defaults to 0.

### .env configuration

```
PORTKEY_API_KEY=<key>
PORTKEY_BASE_URL=https://portkeygateway.perficient.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

## Verification checklist

- [x] Pi Agent + Portkey headers work (`scripts/pi-verify.ts`)
- [x] Tool calling works through Pi's AgentTool format
- [x] Events stream correctly (agent_start, tool_execution_*, agent_end)
- [x] Token usage is returned
- [x] Faux provider works via Pi's native `registerFauxProvider` for testing
- [x] E2e test passes with Pi Agent (31 test files, 110 tests)
- [x] Budget enforcement via beforeToolCall/afterToolCall hooks
- [x] assemble_output captured via closure ref + agent.abort()
- [x] Dual-model: Sonnet investigation -> Haiku assembly via setModel()
- [x] Cost controls: result capping, context pruning, prompt caching
