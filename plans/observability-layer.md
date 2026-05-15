# Plan: Full Observability Layer

## Context

The agent system already captures per-tool timing, timestamps, and aggregated token metrics — but lacks the granularity needed for proper debugging and cost analysis. When a run takes 4 minutes, you can't tell if it's model thinking, slow tools, retries, or context compression. This plan adds full observability across 7 incremental phases, each independently shippable.

---

## Phase 1: Per-Turn LLM Telemetry on StepEvent

**Goal**: Expose individual turn latency, tokens, and running cost per event.

**Files**:
- `src/agent/runnerTypes.ts` — Add optional fields to `StepEvent`
- `src/agent/agentLoopContext.ts` — Capture per-turn data in `message_end`, emit on next `onStep`
- `src/agent/usageTracking.ts` — Add running cost helper

**New StepEvent fields**:
```typescript
llmDurationMs?: number;          // model inference time for this turn
turnTokens?: { input: number; output: number; cached: number };
costSoFar?: number;              // running USD total after this step
```

**How**: `message_end` already computes `turnLlmMs` and has `msg.usage`. Store in `lastTurnLlmMs` / `lastTurnTokens`, compute `costAccumulator += turnCost`, emit all three on the next tool_call event.

---

## Phase 2: Context Compression & Idle Time

**Goal**: Make the silent `transformContext()` call visible; track inter-step gaps.

**Files**:
- `src/agent/contextCompression.ts` — Add timing wrapper + `onCompress` callback
- `src/agent/agentLoopContext.ts` — Track `lastToolEndMs`, compute idle time, accept compression callback

**New StepEvent fields**:
```typescript
compressionMs?: number;          // time spent compressing before this turn
idleMs?: number;                 // gap between prev tool end and this LLM turn start
```

**New accumulator**: `compressionStats = { totalMs: 0, calls: 0, messagesDropped: 0 }`

---

## Phase 3: Retry & Rate Limit Aggregation

**Goal**: Track total backoff time, 429 count, retry patterns at run level.

**Files**:
- `src/agent/agentLoopContext.ts` — Add `retryStats` accumulator
- `src/agent/runner.ts` — Accumulate in existing `onRetry` callback
- `src/types/output.ts` — New `RunDiagnostics` interface
- `src/agent/usageTracking.ts` — Accept diagnostics in `buildMetrics()`

**New RunMetrics field**:
```typescript
diagnostics?: RunDiagnostics;
```

**RunDiagnostics shape**:
```typescript
export interface RunDiagnostics {
  retryStats: {
    totalAttempts: number;
    totalWaitMs: number;
    rateLimitCount: number;
    byStatus: Record<number, number>;
  };
  compressionStats: {
    totalMs: number;
    calls: number;
    avgMessagesDropped: number;
  };
  idleStats: {
    totalIdleMs: number;
    avgIdleMs: number;
  };
  efficiency: {
    repeatedCalls: number;
    toolErrorRate: number;
    uniqueToolCallRatio: number;
  };
  investigationBreadth: {
    uniqueFiles: number;
    uniqueDirectories: number;
    totalToolCalls: number;
    fileToCallRatio: number;
  };
}
```

---

## Phase 4: State Evolution Tracking

**Goal**: Reconstruct the "investigation curve" — how findings and coverage evolve.

**Files**:
- `src/agent/runnerTypes.ts` — Add `stateSnapshot` to StepEvent
- `src/agent/agentLoopContext.ts` — Populate snapshot from existing state on each `tool_call` event

**New StepEvent field**:
```typescript
stateSnapshot?: {
  findingsCount: number;
  filesReadCount: number;
  toolCallsUsed: number;
  budgetRemaining: number;
};
```

---

## Phase 5: Decision Quality Signals

**Goal**: Flag inefficient agent behavior (repeated calls, error rate, breadth).

**Files**:
- `src/agent/agentLoopContext.ts` — Add `toolCallSignatures` map for dedup detection
- `src/agent/runnerTypes.ts` — Add `repeated?: boolean` to StepEvent
- `src/types/output.ts` — Add `efficiency` to `RunDiagnostics`

**Logic**: `signature = toolName + ':' + JSON.stringify(sortedArgs)`. If signature seen before, flag event as `repeated: true`.

---

## Phase 6: RunTimeline Post-Hoc Analysis

**Goal**: Structured timeline type for debugging and dashboard visualization.

**Files**:
- New `src/types/timeline.ts` — `RunTimeline`, `TimelinePhase`, `TimelineEntry` types
- New `src/output/buildTimeline.ts` — Pure function: `StepEvent[] → RunTimeline`
- `dashboard/src/lib/agentSession.ts` — Persist `timeline.json` alongside events

**RunTimeline includes**:
- Phase list with start/end/duration (investigation → writing → assembly → verification)
- Per-entry type classification (llm_turn, tool_call, compression, retry, idle)
- Breakdown: `{ llmMs, toolMs, compressionMs, retryMs, idleMs }` summing to total

Built post-hoc from enriched events (after phases 1-5 land). Not computed during the run.

---

## Phase 7: Logger-Based Debug Instrumentation

**Goal**: Rich `LOG_LEVEL=debug` output for local dev that doesn't bloat persisted events.

**Files**:
- `src/agent/agentLoopContext.ts` — Debug log at message_start, afterToolCall, budget gates
- `src/agent/contextCompression.ts` — Debug log compression stats
- `src/agent/runner.ts` — Debug log phase transitions

Uses existing `logger.debug()`. Zero overhead when `LOG_LEVEL` is info or above.

---

## Implementation Order

| Phase | Effort | Dependencies | Key Benefit |
|-------|--------|---|---|
| 1 | Small | None | "Where is time going?" answered per-event |
| 7 | Small | None | Immediate debug visibility for development |
| 3 | Small | None | Retry/429 cost visible in run output |
| 4 | Small | None | Investigation progress curve |
| 2 | Medium | Phase 1 patterns | Compression + idle time visible |
| 5 | Medium | Phase 4 | Agent efficiency scoring |
| 6 | Medium | Phases 1-5 | Full timeline reconstruction |

---

## Verification

After each phase:
1. `npx tsc --noEmit` — types compile clean
2. `pnpm test` — existing tests pass (new fields are optional, no breaking changes)
3. Run a real analysis with `LOG_LEVEL=debug --verbose` — verify new data appears in events
4. Check persisted `events.jsonl` — new fields present on events
5. After Phase 6: verify `timeline.json` is generated and loadable

After all phases:
- Run `pnpm analyze --repo ./test/fixtures/sitecore-minimal --verbose` with `LOG_LEVEL=debug`
- Inspect the output `events.jsonl` — every event should have `llmDurationMs`, `turnTokens`, `costSoFar`, `stateSnapshot`
- Inspect `RunMetrics.diagnostics` — all sub-objects populated
- Inspect `timeline.json` — phases correctly detected, breakdown sums to total duration
