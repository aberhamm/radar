# Plan: Specialist Worker Mode + Sub-Agent UI Panel

## Context

Sequential specialist passes (Next.js, Accessibility) currently run as full agents — they switch to Haiku, write output via `assemble_output`, then that output is discarded. Only their findings are merged. This wastes budget on writing nobody reads, and the dashboard shows a confusing model-switch → assemble lifecycle that produces nothing visible.

**Goal:** Keep specialists on Sonnet for their entire budget (better investigation quality), and display them in the dashboard as compact sub-agent pills that users can toggle into to see specialist-specific tool calls and findings.

---

## Part 1: Backend — Switch Specialists to Worker Mode

Two one-line changes. Worker mode is already implemented in the runner — just need to opt in.

### Files to modify

| File | Change |
|------|--------|
| `src/commands/analyzeAll.ts` | Add `mode: 'worker'` to Next.js runAgent (line ~248) and A11y runAgent (line ~289) |
| `dashboard/src/lib/dashboardAnalyzeAll.ts` | Add `mode: 'worker'` to Next.js runAgent (line ~208) and A11y runAgent (line ~280) |

### Effect
- `switch_to_fast_model` tool blocked → specialist stays on Sonnet the whole time
- `assemble_output` tool blocked → no wasted writing phase
- Runner skips Phase 6 post-processing → returns immediately with findings + metrics
- No `model_switch` or `assemble_output` events emitted by specialists

---

## Part 1B: Backend — Tag Specialist Events with specialistId

Events in the specialist onStep wrapper must be tagged with a `specialistId` field (same pattern as `workerId` in parallel mode). This is more robust than temporal inference from pass_boundary/pass_complete positions. SSE reconnects or buffered batches can't misroute.

| File | Change |
|------|--------|
| `dashboard/src/lib/dashboardAnalyzeAll.ts` | Wrap Next.js `onStep` to inject `specialistId: 'nextjs-specialist'` on each event |
| `dashboard/src/lib/dashboardAnalyzeAll.ts` | Wrap A11y `onStep` to inject `specialistId: 'a11y-specialist'` on each event |

---

## Part 2: Dashboard — Specialist Sub-Agent Panel

### Architecture

Shared base component + variants pattern, with explicit event tagging:

1. **State tracking**: `specialists` map + per-specialist event accumulators in `useLiveAnalysis`
2. **Event routing**: Events with `specialistId` field → routed directly to that specialist's accumulator (NOT temporal inference)
3. **pass_complete handling**: New handler sets specialist status to 'complete', flushes accumulator, updates metrics from JSON payload (with try/catch for malformed JSON)
4. **UI**: Shared `LaneGrid` base component extracted from `WorkerLaneGrid`, with `SpecialistLaneGrid` variant that adds "Core" pill + deterministic specialist colors
5. **DRY fix**: Extract `parseFinding()` helper from the duplicated 60-line finding parse + dedup logic (lines 246-306 and 473-548 of useLiveAnalysis.ts)

### Step 2A: Extract `parseFinding()` helper

Extract the duplicated finding parse + dedup + merge logic from `useLiveAnalysis.ts` into a standalone pure function. Currently duplicated at lines 246-306 (parallel path) and 473-548 (non-parallel path). The helper handles: JSON parse, dedup by category + 50% evidence file overlap, severity merge (keep highest), evidence merge (union by file:line key).

```typescript
function parseFinding(ev: StepEvent, findings: Finding[]): void {
  // ... extracted logic, modifies findings array in place
}
```

### Step 2B: New types in `useLiveAnalysis.ts`

```typescript
export interface SpecialistState {
  id: string;                // 'nextjs-specialist'
  name: string;              // 'Next.js Specialist'
  status: 'running' | 'complete' | 'skipped';
  toolCalls: number;
  budget: number;
  findingsCount: number;
  currentActivity: string;
  color: string;
}
```

Add to `LiveAnalysisState`:
```typescript
specialists: Map<string, SpecialistState> | null;
selectedSpecialistId: string | null;  // null = show Core
```

### Step 2B: Per-specialist accumulators in `useLiveAnalysis`

Inside the `useMemo`, add (analogous to `WorkerAccum`):

```typescript
interface SpecialistAccum {
  turns: StreamTurn[];
  currentReasoning: string;
  currentActivities: Activity[];
  pendingDeltaText: string;
}
const specialistAccum = new Map<string, SpecialistAccum>();
let specialists: Map<string, SpecialistState> | null = null;
let activeSpecialistId: string | null = null;
let selectedSpecialistId: string | null = null;
```

### Step 2C: Event routing logic

**On `pass_boundary` (specialist name detected):**
- Initialize specialist in `specialists` map with status 'running'
- Create empty accumulator in `specialistAccum`
- Auto-select if first specialist

**Event routing by `specialistId` field (NOT temporal inference):**
- Events with `ev.specialistId` set → route to that specialist's accumulator
- Route `text_response`, `text_delta`, `tool_start`, `tool_call`, `record_finding`, `finding_progress` events
- Increment specialist's `toolCalls` and `findingsCount`
- Findings still go into the shared `findings[]` pool via `parseFinding()` helper

**On `pass_complete` (specialist name detected) — NEW handler:**
- Set specialist status to 'complete'
- Parse metrics from JSON payload (wrapped in try/catch — malformed JSON falls back to status='complete' with no metrics)
- Flush pending reasoning from accumulator
- Update status message

### Step 2D: Add `selectedSpecialistOverride` parameter

Same pattern as existing `selectedWorkerOverride`:

```typescript
export function useLiveAnalysis(
  events, runStatus, toolCalls, budget,
  selectedWorkerOverride?: string | null,
  selectedSpecialistOverride?: string | null,  // NEW
): LiveAnalysisState
```

### Step 2E: Final state resolution

When `selectedSpecialistId` is set (not null/not 'core'):
- Return that specialist's `acc.turns` as `turns`
- Return specialist's pending text as `typingText`

When null:
- Return core turns (existing behavior)

### Step 2F: Page-level state (`page.tsx`)

```typescript
const [selectedSpecialist, setSelectedSpecialist] = useState<string | null>(null);
```

Pass to `useLiveAnalysis` and `AnalysisView`.

### Step 2G: `AnalysisView.tsx` changes

- Accept new prop: `onSelectSpecialist?: (id: string | null) => void`
- Derive `hasSpecialists` from `liveState?.specialists`
- Render `SpecialistLaneGrid` between PhaseRail and ReasoningStream when specialists exist (only in non-parallel mode)

### Step 2H: Shared `LaneGrid` base + `SpecialistLaneGrid` variant

**Extract shared base from `WorkerLaneGrid.tsx`:**

Create `LaneGrid.tsx` with the shared mechanics:
- Flex pill container with selection state, gap, scrollable overflow
- Per-pill: click handler, color CSS var injection, selected/active/complete styling
- Dot indicator animation, finding badge

**Modify `WorkerLaneGrid.tsx`:** Use `LaneGrid` base, provide worker-specific content (progress bar showing toolCalls/budget, "Waiting" status for pending).

**Create `SpecialistLaneGrid.tsx`:** Use `LaneGrid` base with:
- First pill is "Core" (clicking sets selectedSpecialistId to null)
- Tool call count display (no budget progress bar)
- Status: spinner while running, checkmark + finding badge when complete, "Skipped" when skipped
- Deterministic colors: Next.js = `#0070f3`, A11y = `#8b5cf6`

Layout:
```
[ Core ✓ ] [ Next.js ⟳ 3 ] [ Accessibility • ]
```

---

## Implementation Order

1. Backend (Part 1 + 1B) — add `mode: 'worker'` to 4 locations + `specialistId` tagging in 2 onStep wrappers
2. Extract `parseFinding()` helper (Step 2A) — DRY fix, no behavior change
3. State layer (Steps 2B–2E) — specialist types, accumulators, pass_complete handler, event routing
4. LaneGrid extraction (Step 2H) — shared base from WorkerLaneGrid + SpecialistLaneGrid variant
5. Page wiring (Steps 2F–2G) — state + prop threading + AnalysisView integration
6. Tests — 4 unit tests in `test/dashboard/useLiveAnalysis.specialist.test.ts`

---

## Files to create/modify

| File | Action |
|------|--------|
| `src/commands/analyzeAll.ts` | Modify: add `mode: 'worker'` to 2 specialist calls |
| `dashboard/src/lib/dashboardAnalyzeAll.ts` | Modify: add `mode: 'worker'` to 2 specialist calls + `specialistId` tagging in onStep wrappers |
| `dashboard/src/lib/useLiveAnalysis.ts` | Modify: extract `parseFinding()`, add SpecialistState type, accumulators, pass_complete handler, event routing by specialistId, selection |
| `dashboard/src/components/AnalysisView.tsx` | Modify: add specialist grid rendering + prop |
| `dashboard/src/components/analysis/LaneGrid.tsx` | Create: shared pill base component extracted from WorkerLaneGrid |
| `dashboard/src/components/analysis/WorkerLaneGrid.tsx` | Modify: refactor to use LaneGrid base |
| `dashboard/src/components/analysis/SpecialistLaneGrid.tsx` | Create: specialist variant with Core pill + deterministic colors |
| `dashboard/src/app/[[...slug]]/page.tsx` | Modify: add selectedSpecialist state |
| `test/dashboard/useLiveAnalysis.specialist.test.ts` | Create: 4 unit tests (event routing, pass_complete, parseFinding, regression) |

---

## Verification

1. **Backend**: Run `pnpm radar analyze --repo <path> --goal all --verbose` and confirm specialist pass events contain no `switch_to_fast_model` or `assemble_output` actions
2. **Dashboard**: Start dev server, trigger a multi-goal run, verify:
   - Specialist pills appear after Core completes
   - Clicking a pill switches the reasoning stream to that specialist's events
   - Findings from specialists appear in the shared RightPanel
   - PhaseRail progress continues through specialist passes
   - Completed specialists show checkmark + finding count
3. **Regression**: Single-goal runs (no specialists) should be unaffected — no specialist grid appears
4. **Tests**: `pnpm test test/dashboard/useLiveAnalysis.specialist.test.ts`
5. **WorkerLaneGrid regression**: Verify parallel mode still works after LaneGrid base extraction

---

## Eng Review Decisions (2026-05-14)

| # | Issue | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | pass_complete not handled in useLiveAnalysis | Add handler with try/catch | Without it, specialist pills show "running" forever |
| 2 | Event routing: temporal vs tagged | Tag events with specialistId | Robust against SSE reconnects; matches parallel mode pattern |
| 3 | New component vs reuse | Shared LaneGrid base + variants | DRY, avoids duplicating 117 lines of pill rendering |
| 4 | Duplicated finding parse logic | Extract parseFinding() helper | Prevents a third copy; existing duplication is tech debt |
| 5 | Test scope | Full unit coverage (4 tests) | Critical paths: routing, pass_complete, regression |

## TODO (deferred)

- **P3: Split useLiveAnalysis.ts into modular event routers** — File is 780 lines with 3 routing paths (parallel, specialist, single-track). After specialist mode lands, extract into smaller modules sharing a common event-processing interface.
