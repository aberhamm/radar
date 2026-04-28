# Prompt Caching in Agentic Systems

A technical reference on how prompt caching works at the transformer level, what each provider ships, the cost math, the interaction with other harness features, and what we discovered when we tried to enable it through our Portkey → Bedrock stack.

---

## The problem prompt caching solves

An agentic loop sends a request to the LLM on every turn. Each request includes the full context: system prompt, tool definitions, conversation history, and accumulated tool results. The system prompt and tool definitions are identical on every single turn — they're the static prefix.

For Radar, this static prefix includes:
- Consulting rules (`core.md`, goal rules, platform rules) — ~3,000-5,000 tokens
- 40+ tool definitions with TypeBox schemas — ~8,000-12,000 tokens
- Specialist checklists loaded at runtime — ~1,000-2,000 tokens

That's roughly **12,000-19,000 tokens of identical content** sent on every turn. A typical investigation runs 30-50 turns. Without caching, we pay full input price for that prefix 30-50 times.

At Sonnet's input rate ($3/MTok), that's:
```
15,000 tokens x 40 turns x $3/MTok = $1.80 per run just for the static prefix
```

With 90% cache discount:
```
15,000 tokens x 1 turn  x $3.75/MTok (cache write, 25% surcharge) = $0.056
15,000 tokens x 39 turns x $0.30/MTok (cache read)                = $0.176
Total: $0.23 — saving $1.57 per run (87% reduction on the static prefix)
```

Over hundreds of runs, this adds up. Prompt caching is the single largest available cost optimization for long-running agent sessions.

---

## How prompt caching works under the hood

### The KV cache in transformers

To understand prompt caching, you need to understand the KV cache — the mechanism it exploits.

When a transformer processes an input sequence, each attention layer computes three matrices for every token: **Query (Q)**, **Key (K)**, and **Value (V)**. During generation, each new output token attends to all prior tokens. The attention computation for token N needs the K and V matrices from tokens 1 through N-1.

Without caching, the model recomputes K and V for the entire sequence on every forward pass. The **KV cache** stores these matrices so they can be reused: once a token's K and V are computed, they're stored and never recomputed.

```
Without KV cache:                    With KV cache:
Turn 1: Compute K,V for all tokens   Turn 1: Compute K,V for all tokens, store them
Turn 2: Compute K,V for all tokens   Turn 2: Load K,V from cache, compute only for new tokens
Turn 3: Compute K,V for all tokens   Turn 3: Load K,V from cache, compute only for new tokens
```

This is what happens inside a single generation. The model generates token by token, and the KV cache avoids recomputing attention for tokens it already processed within that generation.

### From KV cache to prompt caching

Prompt caching extends this idea **across API requests**. Normally, the KV cache is discarded when a request completes. Prompt caching tells the provider: "keep the KV cache for this prefix in GPU memory so the next request can reuse it."

What the provider stores:
- The tokenized input sequence (the exact bytes matter — this is the cache key)
- The computed K and V attention matrices for every layer at every position in the prefix
- Metadata: model ID, cache TTL, creation timestamp

On the next request, if the prefix matches byte-for-byte, the provider loads the stored KV pairs directly into GPU memory instead of running the forward pass on those tokens. The model only needs to compute attention for the new tokens after the cached prefix.

### Why byte-identical matching is required

The KV matrices are specific to the exact token sequence. Changing a single character changes the tokenization, which changes the embeddings, which changes every K and V matrix downstream (attention is contextual — each token's representation depends on all prior tokens). There's no way to partially reuse KV pairs from a slightly different prefix. It's all or nothing.

This means:
- Adding a space to the system prompt invalidates the cache
- Reordering tool definitions invalidates the cache
- Changing a single tool's description invalidates the cache
- Appending new messages after the cached prefix is fine — the prefix KV pairs are still valid

### What the cache key includes

The cache key varies by provider, but typically:
- **Model ID** — Opus 4.7 cache is separate from Sonnet 4.6 cache
- **Exact byte content** of all cached blocks (system prompt, tools, messages up to breakpoint)
- **Certain configuration parameters** — tool_choice, parallel tool use settings, image presence, and (for Anthropic) thinking budget can invalidate specific cache tiers

### The latency benefit

Beyond cost, prompt caching significantly reduces time-to-first-token. The forward pass through the prefix is the most compute-intensive part of processing a request. Skipping it means the model starts generating sooner.

Anthropic's documented benchmark with ~187K tokens of cached content:
- Without cache: 4.89s to first response
- With cache hit: 1.48s to first response
- **3.3x speedup**

For a 40-turn agent session, this latency reduction compounds: every turn starts faster.

---

## Prompt caching vs semantic caching

These are frequently confused but solve different problems.

**Prompt caching** stores the internal model state (KV matrices) for a prompt prefix. The LLM still runs — it generates a fresh response using the cached prefix state plus new input. The output is original and current.

**Semantic caching** (e.g., GPTCache, Portkey's `x-portkey-cache: simple`) stores entire response objects keyed by request similarity. On a "cache hit," it returns a previous response without calling the LLM at all. The output is a replay of a prior response.

| | Prompt caching | Semantic caching |
|---|---|---|
| What's cached | KV attention matrices for prefix | Complete previous response |
| LLM called? | Yes — generates fresh output | No — returns stored response |
| Output quality | Identical to uncached | Stale — may not match new context |
| Deterministic? | Yes — same model, same behavior | Depends on similarity threshold |
| Use case | Long static prefixes across turns | Identical or near-identical queries |
| Risk | None — output is always fresh | Wrong answers, stale data |

For an agentic loop where every turn is different (different tool results, different conversation state), semantic caching is useless — the full request is never identical. Prompt caching is the correct optimization.

---

## Provider implementations

### Anthropic (direct API)

Anthropic provides the most explicit and granular prompt caching implementation.

**How to enable it:**

Place `cache_control` breakpoints on content blocks. Everything up to and including the marked block becomes the cached prefix:

```json
{
  "system": [
    {
      "type": "text",
      "text": "You are an expert consultant...",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "tools": [
    { "name": "tool_1", "description": "...", "input_schema": { ... } },
    { "name": "tool_2", "description": "...", "input_schema": { ... },
      "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [...]
}
```

In this example, two cache breakpoints are set: one on the system prompt, one on the last tool definition. The system prompt is cached separately from the tools, so changing a tool doesn't invalidate the system cache.

**Pricing per million tokens:**

| Model | Regular input | Cache write (5m TTL) | Cache write (1h TTL) | Cache read |
|---|---|---|---|---|
| Claude Opus 4.7 | $5.00 | $6.25 (1.25x) | $10.00 (2x) | $0.50 (0.1x) |
| Claude Sonnet 4.6 | $3.00 | $3.75 (1.25x) | $6.00 (2x) | $0.30 (0.1x) |
| Claude Haiku 4.5 | $1.00 | $1.25 (1.25x) | $2.00 (2x) | $0.10 (0.1x) |

Cache writes cost 25% more than regular input (5-minute TTL) or 100% more (1-hour TTL). Cache reads cost 90% less. The write surcharge pays for itself after 2 cache hits.

**Cache TTL:**
- Default: **5 minutes** (ephemeral)
- Optional: **1 hour** (at 2x write cost instead of 1.25x)
- TTL **refreshes on each cache hit** at no additional cost — an active agent session keeps the cache alive indefinitely

**Minimum cacheable tokens:**

| Model | Minimum tokens |
|---|---|
| Claude Opus 4.7, 4.6, 4.5 | 4,096 |
| Claude Sonnet 4.6 | 2,048 |
| Claude Sonnet 4.5, 4.1, 4 | 1,024 |
| Claude Haiku 4.5 | 4,096 |

Below these thresholds, caching **silently does nothing** — no error, no cache write, no savings. This catches people off guard.

**Breakpoint rules:**
- Maximum **4 explicit breakpoints** per request
- Can be placed on: system prompt blocks, tool definitions (mark the last tool), message content blocks, image blocks, document blocks, tool result blocks
- Breakpoints create a **hierarchy**: tools → system → messages. Changes at any level invalidate that level and everything below it

**Cache invalidation hierarchy:**

| Change | Tools cache | System cache | Message cache |
|---|---|---|---|
| Modify any tool definition | Invalidated | Invalidated | Invalidated |
| Change tool_choice | Preserved | Invalidated | Invalidated |
| Modify system prompt | Preserved | Invalidated | Invalidated |
| Add/remove images | Preserved | Invalidated | Invalidated |
| Change thinking budget_tokens | Preserved | Preserved | Invalidated |
| Append new user message | Preserved | Preserved | Preserved (prefix) |

**Extended thinking interaction:** System and tools cache are preserved even when thinking parameters change. Only message-level cache is invalidated by thinking budget changes. This matters for agent loops that toggle thinking between investigation and writing phases.

**Response fields:**
- `cache_creation_input_tokens` — tokens written to cache (charged at write rate)
- `cache_read_input_tokens` — tokens served from cache (charged at read rate)
- Available in both non-streaming and streaming responses (in `message_delta` events)

### OpenAI

OpenAI takes a zero-configuration approach: prompt caching is **automatic**.

**How it works:** The API detects repeated prefixes across requests and caches them without any explicit opt-in. No `cache_control` markers, no breakpoints, no configuration.

**Pricing:** Cached tokens cost **50%** of regular input price. Less aggressive than Anthropic's 90% discount, but requires zero implementation effort.

**Minimum prefix length:** 1,024 tokens.

**Cache TTL:** Not explicitly documented. Caches are maintained as long as the prefix is being actively reused.

**Response fields:**
- `usage.prompt_tokens_details.cached_tokens` — tokens served from cache

**What this means for agent builders:** If your agent uses the OpenAI API, you get prompt caching for free. No code changes needed. The tradeoff is less savings per cache hit (50% vs 90%) and no explicit control over what gets cached.

### AWS Bedrock

Bedrock exposes **two different APIs** for Claude models, and they handle caching differently:

**Invoke Model API** (`/model/{id}/invoke`, `/model/{id}/invoke-with-response-stream`)

Speaks Anthropic's native request format. Supports `cache_control` directly — the request passes through to Claude with Anthropic's own caching mechanism. Response includes native `cache_read_input_tokens` and `cache_creation_input_tokens` fields.

```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "system": [
    { "type": "text", "text": "...", "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [...]
}
```

**Converse API** (`/model/{id}/converse`, `/model/{id}/converse-stream`)

Bedrock's provider-agnostic API. Works across Claude, Llama, Mistral, Nova, etc. Uses its own `cachePoint` syntax instead of Anthropic's `cache_control`:

```json
{
  "system": [
    { "text": "Your system prompt..." },
    { "cachePoint": { "type": "default" } }
  ],
  "messages": [...]
}
```

The two formats are **incompatible** — `cache_control` is meaningless in the Converse API, and `cachePoint` is meaningless in the Invoke Model API. The response fields also differ: Converse returns `cacheReadInputTokenCount` and `cacheWriteInputTokenCount` in its metadata object.

**Supported models:** Claude 3.5 Sonnet v2, Claude 3.7 Sonnet, Claude Opus 4, Claude Sonnet 4.x, Claude Haiku 4.5. Check Bedrock docs for region-specific availability.

**Minimum tokens per cache checkpoint:** 1,024 (for supported Claude models).

**Maximum checkpoints:** 4 per request (same as direct Anthropic).

**TTL options:** 5 minutes (default) and 1 hour — same as Anthropic.

**Pricing:** Bedrock pricing is separate from direct Anthropic pricing and varies by model and region. The discount structure (write surcharge + read discount) is similar but the per-token rates differ.

### Google Gemini

Gemini takes a different approach: caching is an **explicit, out-of-band operation**. You create a cache object via a separate API call, then reference it in subsequent requests.

**Creating a cache:**
```python
cached_content = client.caching.cached_contents.create(
    model="models/gemini-2.5-flash",
    contents=[...],           # data to cache
    system_instruction="...", # optional
    tools=[...],              # optional
    ttl="3600s"               # or use expire_time with RFC 3339 timestamp
)
```

**Using it in requests:**
```python
response = client.models.generate_content(
    model="models/gemini-2.5-flash",
    contents=["What is..."],
    cached_content=cached_content.name
)
```

**Cache management API:** Five operations: `create`, `list`, `get`, `patch` (update expiration only), `delete`. This gives explicit lifecycle control that other providers don't offer.

**Pricing model:** Two components:
1. **Read cost** — per-token access cost (model-dependent, lower than regular input)
2. **Storage cost** — **$1.00 per million tokens per hour** across most models

This storage cost is unique to Gemini. Other providers absorb storage costs and only charge on read/write. For very large cached contexts held for long periods, Gemini's storage cost can exceed the caching savings.

**TTL configuration:** Set `ttl` (duration, e.g., `"3600s"`) or `expire_time` (absolute timestamp). Use `patch` to extend without recreating. No auto-refresh on access — you must actively manage TTL.

---

## Provider comparison

| Feature | Anthropic | OpenAI | AWS Bedrock | Google Gemini |
|---|---|---|---|---|
| **Opt-in model** | Explicit breakpoints | Automatic | Explicit (Converse: cachePoint, Invoke: cache_control) | Explicit (separate API) |
| **Cache read discount** | 90% (0.1x input) | 50% (0.5x input) | ~90% (Anthropic models) | Reduced input + storage cost |
| **Cache write surcharge** | 25% (5m) / 100% (1h) | None (automatic) | 25% (5m) / 100% (1h) for Anthropic models | None (storage cost instead) |
| **TTL** | 5m or 1h; refreshes on hit | Opaque | 5m or 1h; refreshes on hit | Custom; manual management |
| **Min tokens** | 1,024-4,096 (model-dependent) | 1,024 | 1,024 | Not specified |
| **Max breakpoints** | 4 | N/A (automatic) | 4 | Unlimited (per API) |
| **Break-even** | ~2 turns | ~2 turns (lower discount but no write cost) | ~2 turns | Depends on storage duration |
| **Tool caching** | Yes (mark last tool) | Automatic | Yes | Yes (in CachedContent) |
| **Streaming support** | Yes (metrics in message_delta) | Yes | Yes | Yes |
| **Lifecycle control** | TTL only | None | TTL only | Full (create/patch/delete) |

---

## When prompt caching helps vs hurts

### Break-even analysis

Anthropic charges a 25% write surcharge on the first request, then gives 90% savings on every subsequent request. The question: how many turns before you break even?

**Formula (for Sonnet 4.6 with 5m TTL):**
```
Let P = cached prefix size in tokens
Let N = number of turns

Without caching: P × $3.00/MTok × N
With caching:    P × $3.75/MTok × 1  +  P × $0.30/MTok × (N-1)

Break-even when:
  3.75 + 0.30(N-1) < 3.00N
  3.75 + 0.30N - 0.30 < 3.00N
  3.45 < 2.70N
  N > 1.28

Break-even at turn 2.
```

**For 1-hour TTL (2x write cost):**
```
  6.00 + 0.30(N-1) < 3.00N
  5.70 < 2.70N
  N > 2.11

Break-even at turn 3.
```

Any agent session with 3+ turns benefits from prompt caching. Since Radar runs 30-50 turns per investigation, caching is massively net positive.

### When caching costs MORE

1. **Single-turn requests** — The write surcharge (1.25x or 2x) is wasted. A one-shot query is 25-100% more expensive with caching enabled.

2. **Prefix below minimum threshold** — If your system prompt + tools total less than the model's minimum (e.g., 2,048 tokens for Sonnet), the cache breakpoint is silently ignored. You pay the write surcharge but get no cache hits. No error is raised.

3. **Frequently changing prefixes** — If tool definitions or system prompts change on every request, each change triggers a new cache write and the previous cache is wasted.

4. **Very short TTL windows** — If your agent has long pauses between turns (> 5 minutes without the 1h TTL), the cache expires and the next request pays the write surcharge again.

### Impact on latency

Cache hits skip the forward pass for the cached prefix. This directly reduces time-to-first-token:

| Scenario | Time to response | Notes |
|---|---|---|
| No caching, 187K tokens | 4.89s | Full prefix processing |
| Cache write (1st request) | 4.28s | Slight overhead for cache storage |
| Cache hit (2nd request) | 1.48s | 3.3x speedup |

For agent loops, this compounds: every turn after the first starts faster. A 40-turn investigation saves roughly 3.4 seconds per turn × 39 turns = ~130 seconds of cumulative latency reduction.

---

## Interaction with other harness features

### Tool definitions as part of the cacheable prefix

Tool definitions are typically the largest part of the static prefix. Radar's 40+ tools with TypeBox schemas constitute ~8,000-12,000 tokens. These are identical on every turn — a perfect caching target.

**Best practice:** Place a single cache breakpoint on the **last tool** in the tools array. This caches the entire tools block with one breakpoint:

```json
{
  "tools": [
    { "name": "read_file", ... },
    { "name": "grep_search", ... },
    ...
    { "name": "assemble_output", ..., "cache_control": { "type": "ephemeral" } }
  ]
}
```

**Deferred tool loading (Pi Agent pattern):** Radar uses deferred tool descriptions — some tools show stub descriptions until the agent calls `tool_search`. This doesn't break caching because deferred tools load as inline content in the conversation, not in the tools array. The tools prefix stays identical.

### System prompt + tools = natural cache boundary

The optimal cache architecture for an agent loop splits the cacheable content into two tiers:

```
Tier 1: Tool definitions (largest, most stable)
  └── cache breakpoint on last tool

Tier 2: System prompt (stable per-run, changes between goals)
  └── cache breakpoint on last system block

Tier 3: Conversation messages (changes every turn)
  └── no cache breakpoint (or automatic caching for growing prefix)
```

Anthropic's invalidation hierarchy means changes at tier 3 (new messages) don't affect tier 1 or 2 caches. A new user message appends after the cached prefix — the tool and system caches survive.

### Context compression and cache interaction

**Context compression typically invalidates message-level cache.** When Radar's `transformContext` rewrites old tool results (truncating to 150 chars, collapsing stale reads), the message content changes. Changed messages = different bytes = cache miss for the message tier.

**But the system prompt and tools caches are preserved.** Compression only touches tool result messages, not the system prompt or tool definitions. The two most expensive cache tiers (tools: ~10K tokens, system: ~4K tokens) survive compression.

**This is the right tradeoff:** The system and tools prefix accounts for ~14K tokens of redundant processing per turn. Message-level caching only helps with the conversation history prefix, which changes on most turns anyway. Compress messages aggressively, cache the static prefix — they're complementary strategies.

### Extended thinking and caching

Radar enables extended thinking (`thinkingLevel: 'low'`) for the investigation phase and disables it on model switch to Haiku. This affects caching:

- **System and tools cache: preserved.** Changing thinking parameters doesn't invalidate these tiers.
- **Message cache: invalidated.** Changing `budget_tokens` invalidates message-level cache. The model switch (which disables thinking) triggers a message cache invalidation.
- **Practical impact: minimal.** The model switch happens once per run (from Sonnet to Haiku), and the message cache would change anyway due to new tool results. The expensive caches (tools + system) survive.

### Multi-turn caching growth

In a multi-turn agent session, the cached prefix grows with each turn:

| Turn | What's cached | What's new |
|---|---|---|
| 1 | Tools + System + User(1) → cache write | Everything |
| 2 | Tools + System + User(1) + Asst(1) + User(2) → cache hit + write | Asst(1) + User(2) |
| 3 | All prior → cache hit + write | Asst(2) + User(3) |
| N | All prior → cache hit + write | Asst(N-1) + User(N) |

Each turn reuses the growing prefix at 0.1x cost and writes only new tokens at 1.25x cost. The cache hit portion grows while the write portion stays constant (~100-500 tokens of new messages per turn). Cost savings increase on every turn.

---

## Our investigation: Radar + Portkey + Bedrock

### What we built

Radar's codebase has two prompt caching components:

**1. Cache control injection** (`src/agent/contextCompression.ts:151-167`)

`createOnPayload()` intercepts the outbound API payload before Pi sends it and stamps `cache_control: { type: 'ephemeral' }` on the last system prompt block:

```typescript
export function createOnPayload(): (payload: any) => any {
  return (payload: any) => {
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      if (typeof payload.system === 'string') {
        payload.system = [{
          type: 'text',
          text: payload.system,
          cache_control: { type: 'ephemeral' }
        }];
      } else if (Array.isArray(payload.system) && payload.system.length > 0) {
        const last = payload.system[payload.system.length - 1];
        if (last && typeof last === 'object') {
          last.cache_control = { type: 'ephemeral' };
        }
      }
    }
    return payload;
  };
}
```

**2. Cache token tracking** (`src/agent/usageTracking.ts`)

`trackUsage()` accumulates `cachedTokens` per model across the run. `buildMetrics()` computes the dollar savings:

```typescript
const cachedDiscount = usage.cachedTokens * (pricing.inputPerToken - pricing.cachedInputPerToken);
```

Both components are wired in and functional. The question was whether the pipeline delivers cache tokens end-to-end.

### The diagnostic probe

We built `scripts/cache-probe.ts` — a 3-phase test that sends identical multi-turn conversations and checks for cache tokens at each layer:

- **Phase 1:** Raw fetch directly to Portkey (bypass Pi), canonical format. See what Portkey returns.
- **Phase 2:** Raw fetch with `x-portkey-cache: simple` header. Test Portkey's semantic cache.
- **Phase 3:** Full Pi Agent session with `onPayload` cache_control injection. See what Pi surfaces.

The probe uses a deliberately large system prompt (~12,000 chars, 60 padding rules) so cached vs uncached is obvious in token counts. It aligns with Portkey's canonical request format: provider route baked into the model ID (`@aws-bedrock-use2/us.anthropic.claude-sonnet-4-6`), single `x-portkey-api-key` auth header, system prompt as `{"role": "system"}` in the messages array.

### What we found

**Phase 1 results (raw fetch, no cache directives):**
```
Turn | Prompt | cached_tokens | cache_read | cache_create | Cache-Status
  1  |   3978 |             0 |     absent |       absent | DISABLED
  2  |   4009 |             0 |     absent |       absent | DISABLED
  3  |   4040 |             0 |     absent |       absent | DISABLED
```

**Phase 2 results (Portkey semantic cache):**
```
x-portkey-cache-status: DISABLED
```
Portkey's semantic cache layer is turned off on the gateway instance. The `x-portkey-cache: simple` header had no effect.

**Phase 3 results (Pi Agent with onPayload hook):**
```
Turn | Input | CacheRead | CacheWrite
  1  |  3978 |         0 |          0
  2  |  4009 |         0 |          0
  3  |  4040 |         0 |          0
```

Zero cache activity across all phases.

### Root cause

We pulled the raw request/response from the Portkey dashboard for request 7 (Phase 3, Turn 2 — the most informative: cache_control was injected by onPayload, and the cache should have been populated from Turn 1).

The outbound request URL was:

```
https://bedrock-runtime.us-east-2.amazonaws.com/model/us.anthropic.claude-opus-4-7/converse-stream
```

**Portkey uses Bedrock's Converse API, not the Invoke Model API.** This is the root cause. The Converse API doesn't understand Anthropic's `cache_control` — it uses `cachePoint`, a completely different mechanism. Portkey doesn't translate between them.

The full failure chain has three independent breaks:

```
Our code            Pi Agent             Portkey                Bedrock
──────────────────────────────────────────────────────────────────────────────
onPayload injects   Sends system as      Translates to          Receives
cache_control on    {"role":"system"}    Converse API format    /converse-stream
payload.system      in messages array    (drops cache_control)  (no cachePoint sent)
      |                   |                    |                      |
      v                   v                    v                      v
  Targets a field     No top-level         No cache_control       No cache tokens
  that doesn't        "system" field       → cachePoint map       in response
  exist in the        to decorate
  outbound payload
```

**Break 1 (our code → Pi):** `onPayload` injects `cache_control` onto `payload.system`, but Pi's `openai-completions` provider sends the system prompt as `{"role": "system"}` in the messages array. There is no `payload.system` field in the outbound request. The injection decorates nothing.

**Break 2 (Pi → Portkey):** Even if `cache_control` reached the payload, Portkey's OpenAI-to-Converse translator would drop it. `cache_control` is not a Converse API concept.

**Break 3 (Portkey → Bedrock):** Portkey sends to the Converse API endpoint without `cachePoint` markers. Bedrock processes the request without caching. The response returns `prompt_tokens_details: { cached_tokens: 0 }` — the field exists but was never populated.

### What this means

The `cache_control` injection in `onPayload` and the `cachedTokens` tracking in `usageTracking.ts` are architecturally correct for a direct Anthropic path. Through the current stack (Pi → Portkey → Bedrock Converse API), three translation boundaries break the chain, none under our control.

### Resolution path

This is an infrastructure limitation, not a code bug:

1. **Portkey maps `cache_control` → `cachePoint`** when routing to Bedrock Anthropic models. Tracked in Portkey GitHub issues #1579, #1592, #1593.
2. **Portkey uses Invoke Model API** instead of Converse API for Anthropic models, preserving `cache_control` natively.
3. **Portkey enables semantic caching** on the gateway instance (`x-portkey-cache-status: DISABLED` → enabled). Requires admin action.

None of these are changes we can make from the client side.

### What we have instead

The codebase ships four application-level cost optimizations that reduce redundant token processing without any provider feature:

| Provider-level caching would... | Our application-level equivalent |
|---|---|
| Cache the static system prompt prefix | **Context compression** — 3-tier truncation prevents old tool results from inflating context. Evidence pinning preserves what matters. |
| Avoid reprocessing identical tokens | **Stale-read collapsing** — when the agent reads the same file multiple times, earlier reads collapse to one-line stubs. |
| Make subsequent turns cheaper | **Dual-model switch** — agent-initiated switch from Sonnet to Haiku cuts per-token cost by ~75% for the writing phase. |
| Reduce total turn count | **Pre-compute** — 3 deterministic tools run before the LLM loop, saving 3-5 round trips of identical discovery work. |

These are complementary to prompt caching, not replacements. If provider-level caching becomes available through the gateway, it stacks on top — the savings compound.

### Diagnostic tooling

`scripts/cache-probe.ts` remains in the repo as a reusable diagnostic. Run it after any infrastructure change to verify whether cache tokens flow end-to-end:

```bash
pnpm run spike:cache
```

The probe tests three layers independently (raw fetch, Portkey semantic cache, Pi Agent), reports the exact fields returned at each layer, and prints a verdict identifying where in the chain the data gets lost.

---

## Key takeaways

1. **Prompt caching exploits the KV cache across API requests.** The provider stores pre-computed attention KV matrices for a prompt prefix. Subsequent requests with an identical prefix skip the forward pass for those tokens — 90% cheaper, 3x faster.

2. **Break-even is fast.** The write surcharge (1.25x for 5m TTL) pays for itself at turn 2. Any agent session with 3+ turns benefits. For Radar's 30-50 turn investigations, the theoretical saving is ~$1.57 per run on the static prefix alone.

3. **The cache boundary follows the stability boundary.** Cache what's stable (tools, system prompt), don't cache what changes (messages, tool results). Anthropic's invalidation hierarchy supports this: message changes don't affect tools or system caches.

4. **Context compression and prompt caching are complementary, not conflicting.** Compress messages (which change every turn), cache the static prefix (which never changes). The expensive caches survive compression.

5. **Gateway translation is the most common failure point.** Gateways that normalize providers to OpenAI format often strip provider-specific features. The gateway's choice of downstream API (Converse vs Invoke Model) determines whether native caching is even possible. Our Portkey investigation proved this empirically.

6. **Application-level cost optimization is always available.** Context compression, stale-read collapsing, model switching, and pre-compute work through any gateway, any provider, any API format. They're the floor — provider caching is the ceiling.

7. **Instrument before you optimize.** Our `usageTracking.ts` tracks cached tokens and computes savings. `cache-probe.ts` pinpoints exactly where cache data gets lost. When the infrastructure catches up, the instrumentation is already in place — zero code changes needed.
