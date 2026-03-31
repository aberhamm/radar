# Chunk 0 Spike Results

Date: 2026-03-31

## Pi API Spike

**Result: Pi not available.**

Neither `@anthropic-ai/pi` nor `pi-agent` are published npm packages. Pi is not yet publicly available for tool registration or agent loop management.

**Decision: Use DirectLoopRunner.** A manual tool-calling loop via Portkey's OpenAI-compatible chat completions API. We control the loop, which means all 8 CEO expansion features work natively:

| Feature | DirectLoopRunner support |
|---------|------------------------|
| Interactive/verbose mode | Emit event per loop iteration |
| Multi-provider | provider.chat() in the loop |
| CI/CD goal type | Different goal prompt + budget |
| GitHub hook | Post-run, independent of runner |
| Comparison report | Run loop twice, different repos |
| Run metrics | Track modelUsage per iteration |
| Graceful degradation | try/catch around each iteration |
| Budget extension | Check budget before each iteration |

Pi can be revisited when it becomes publicly available. The abstract runner interface (`AgentRunner`) will support both `DirectLoopRunner` and a future `PiRunner`.

## Portkey + Bedrock Verification

**Result: All checks pass.**

### Gateway setup

- **Gateway**: `portkeygateway.perficient.com/v1`
- **Provider routing**: `x-portkey-provider: @aws-bedrock-use2` header
- **Auth**: `PORTKEY_API_KEY` (no virtual key needed)
- **SDK**: `portkey-ai` npm package, uses `baseURL` + `provider` constructor options

### Model IDs (verified working)

| Model | Bedrock ID | Use |
|-------|-----------|-----|
| Sonnet 4.6 | `us.anthropic.claude-sonnet-4-6` | Main agent (investigation loop, reasoning, tool selection) |
| Haiku 4.5 | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Lightweight tasks (file triage, narrative generation, finding dedup) |

### Tool calling

Works. The model returns `tool_use` blocks when tools are provided. Verified with a simple function definition.

### Finish reasons (Bedrock via Portkey)

Bedrock returns different finish reason values than OpenAI:
- `end_turn` (not `stop`) — normal completion
- `tool_use` (not `tool_calls`) — model wants to call a tool

The `ChatCompletionResponse.finishReason` type has been updated to include both OpenAI and Bedrock variants.

### Token usage

Standard `prompt_tokens` and `completion_tokens` are returned in the usage object.

**Cache tokens: NOT surfaced.** `cache_read_input_tokens` and `cache_creation_input_tokens` are not present in the Portkey response. `RunMetrics.cachedTokens` will default to 0.

### .env configuration

```
PORTKEY_API_KEY=<key>
PORTKEY_BASE_URL=https://portkeygateway.perficient.com/v1
PORTKEY_PROVIDER=@aws-bedrock-use2
PROVIDER_TYPE=portkey
```

## Chunk 0 checklist status

- [x] Pi import paths and tool registration — N/A, Pi unavailable, using DirectLoopRunner
- [x] Portkey Bedrock model ID verification — Sonnet 4.6 + Haiku 4.5 confirmed
- [x] Pi agent loop and termination behavior — N/A, using DirectLoopRunner
- [x] Does Portkey surface Bedrock cache token fields? — **No.** cachedTokens defaults to 0
- [x] Can Pi agent loop be interrupted mid-execution? — N/A, DirectLoopRunner handles this natively
- [x] Does Pi support tool call event callbacks? — N/A, DirectLoopRunner handles this natively
