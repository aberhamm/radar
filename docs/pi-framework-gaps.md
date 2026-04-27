# Pi Framework Gaps

Audit of Pi capabilities vs. what we actually use. Based on pi-mono v0.70.2 (we're on v0.64.0).

**Packages audited:** `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-web-ui`, `pi-skills`

---

## What we use well

| Feature | How |
|---------|-----|
| `Agent` class | Core loop, tool execution, event streaming |
| `beforeToolCall` / `afterToolCall` | Budget enforcement, state tracking, model switching, investigation log |
| `transformContext` | Context eviction with evidence pinning, stale-read collapsing |
| `onPayload` | Manual `cache_control` breakpoint injection for Portkey |
| `getApiKey` | Dynamic API key resolution per LLM call |
| `toolExecution: 'parallel'` | Concurrent tool execution |
| Event subscription | Real-time dashboard streaming, usage tracking, timing |
| TypeBox schemas (`Type`) | 40+ tools with typed parameters via `AgentTool` |
| In-place model mutation | Mid-loop model switch (investigation -> writing) |

---

## High priority

### 1. Enable extended thinking for investigation model

**Gap:** `thinkingLevel: 'off'` (runner.ts:930). Pi supports `minimal` (1024 tokens), `low` (2048), `medium` (8192), `high` (16384), `xhigh`.

**What this is NOT:** We already have a prompt-directed reasoning system (`goal-universal.md:12-39`, `goalPrompts.ts:118-125`) that forces the agent to write visible analytical reasoning between tool calls. That reasoning is client-facing — it appears in the investigation log, streams to the dashboard, and explains *what the agent found and what it means*. This is a feature, not a workaround.

**What extended thinking adds:** A separate, hidden scratchpad the model uses *before* producing its visible response. The model plans internally ("should I read the config next or check dependencies? I've covered 6 of 9 categories, budget is at 60%, time to start recording...") then outputs tool calls and visible reasoning.

**They're complementary:**
- Prompt-directed reasoning = what the client sees (analytical narrative)
- Extended thinking = how the model plans internally (tool sequencing, budget awareness, dedup)

Enabling `thinkingLevel: 'low'` keeps our reasoning rules intact — the model would think internally about *what* to do, then write its visible reasoning about *what it found*.

**Expected gains:**
- Better tool sequencing — plans which tools to call before committing, reducing wasted calls on a budget
- Fewer dead-end investigations — catches "I already checked that" before re-reading files
- Better parallel batching — thinks through which tools can run concurrently before emitting them

**Cost:**
- Token spend increases — thinking tokens are billed at input pricing. At `low` (2048 tokens), ~2K extra tokens per turn. With ~15-20 turns per investigation, roughly 30-40K extra tokens per run.
- Latency per turn increases — model thinks before responding, adding a few seconds per turn.
- Thinking tokens are NOT visible in investigation log or dashboard.
- Monitor via `modelUsage` tracking we already have.

**Approach:** Enable `thinkingLevel: 'low'` or `'medium'` for `AGENT_MODEL` only. Keep `'off'` for `FAST_MODEL` (writing phase doesn't need it). Pi's `ThinkingBudgets` type lets you set per-level token caps.

**Validation:** Run the same repo with thinking on vs. off, compare tool call efficiency and finding quality before committing.

**Where:** runner.ts:930, piModel.ts (model `reasoning` flag)

### 2. Upgrade to v0.70.x

**Gap:** 6 minor versions behind (v0.64.0 -> v0.70.2).

**Notable additions since v0.64:**
- `terminate: true` on `afterToolCall` result — cleaner than our abort pattern
- `timeoutMs`, `maxRetries`, `maxRetryDelayMs` on stream options — replace our custom retry wrapper
- DeepSeek provider support
- TypeBox 1.x migration (breaking — needs schema audit)
- GPT-5.5 Codex support
- Provider retry/timeout forwarding fix

**Risk:** TypeBox 1.x is a breaking change. Audit all `Type.Object()` / `Type.String()` / etc. calls in piToolAdapter.ts.

### 3. Use `isContextOverflow()`

**Gap:** Pi has built-in context overflow detection (18+ provider error patterns + silent overflow via token count). We do custom context eviction in `transformContext` but don't detect when we've actually hit the limit.

**Where:** Import from `@mariozechner/pi-ai`. Use in error handling around `agent.prompt()` for graceful degradation instead of opaque API errors.

### 4. Switch to `cacheRetention` option

**Gap:** We manually inject `cache_control` breakpoints in `onPayload` (runner.ts:908-923). Pi's stream options support `cacheRetention: "short" | "long"` natively across providers.

**Why it matters:** Our approach assumes Anthropic's cache_control format and won't port to other providers. The Pi abstraction handles provider differences.

**Where:** Remove `onPayload` cache injection. Pass `cacheRetention: 'short'` in Agent constructor or stream options.

### 5. Use `agent.steer()` for budget warnings

**Gap:** Budget reminders are injected via result manipulation in `afterToolCall`. Pi has proper `agent.steer(message)` and `agent.followUp(message)` queues with configurable modes (`"all"` vs `"one-at-a-time"`).

**Where:** runner.ts budget warning logic (lines 559-565, 744-750). Replace with `agent.steer()` calls.

---

## Medium priority

### 6. Per-tool `executionMode` overrides

**Gap:** We set `toolExecution: 'parallel'` globally but `record_finding` uses a mutex (`StatefulToolMutex`) for concurrent safety. Pi supports per-tool `executionMode: 'sequential'` overrides on `AgentTool`.

**Where:** piToolAdapter.ts — add `executionMode: 'sequential'` to `record_finding` and `assemble_output` tool definitions. Remove mutex if Pi's sequencing is sufficient.

### 7. Explore `pi-web-ui` for interactive mode

**Gap:** Pi has a full web component library (`<pi-chat-panel>`, `<assistant-message>`, `<thinking-block>`, tool renderer registry, artifact system, session storage). We built a custom React/Next.js dashboard.

**Opportunity:** Not a replacement for the dashboard (different purpose — run history, scorecards, findings vs. live chat). But could enable an interactive "ask follow-up questions about findings" mode.

**Components of interest:**
- `ChatPanel` + `AgentInterface` — full chat UI
- `ThinkingBlock` — collapsible reasoning display
- Tool renderer registry — custom tool visualization
- `SessionsStore` + `AppStorage` — session persistence

---

## Low priority / not relevant

| Item | Reason |
|------|--------|
| `pi-skills` repo | General productivity tools (browser, Gmail, Drive, YouTube). Only `brave-search` overlaps and we already have web search. No code analysis skills. |
| Vision / image input | Not needed for code analysis |
| OAuth flow | We use static API keys via env vars |
| Stream proxy (`streamProxy()`) | We go direct through Portkey gateway |
| Direct loop functions (`agentLoop`, `agentLoopContinue`) | `Agent` class abstracts these; no need for low-level access |
| Provider-specific types | Using `openai-completions` compat layer for portability |

---

## Current Pi usage summary

**Imports (3 files only):**
- `runner.ts` — `Agent`, hook types, `AgentEvent`, `AgentMessage`, `Model`
- `piModel.ts` — `Model` type
- `piToolAdapter.ts` — `Type` (TypeBox), `AgentTool`, `AgentToolResult`

**Not imported but available:**
- `agentLoop()`, `agentLoopContinue()`, `streamProxy()` (low-level, abstracted by Agent)
- `isContextOverflow()`, `calculateCost()`, `getModel()`, `supportsXhigh()`
- `CacheRetention`, `ThinkingLevel`, `ThinkingBudgets` types
- All of `pi-web-ui`

---

*Last updated: 2026-04-27. Based on pi-mono v0.70.2, our version v0.64.0.*
