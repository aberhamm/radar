---
id: 005
title: Live analysis flow E2E test
status: pending
blocked-by: [003]
needs-review: none
created: 2026-05-27
---

## Requirements

The most critical user flow is: user triggers an analysis → SSE stream renders real-time events → run completes → results display (scorecard, findings, brief). This plan creates an E2E test that exercises this full flow using a mocked agent backend, verifying the dashboard handles streaming state transitions correctly.

**Acceptance criteria:**

- [ ] Mock intercepts TWO endpoints: POST `/api/run` returns `{ ok: true, runId }` JSON, and GET `/api/events` returns an SSE stream of scripted events
- [ ] Test verifies: after triggering analysis, the UI transitions to running state with progress indicators
- [ ] Test verifies: EventStream component renders tool call events as they arrive from `/api/events`
- [ ] Test verifies: On `run_complete` event, view transitions to completed state with scorecard and findings
- [ ] Test verifies: Findings count matches the number of `record_finding` events in the stream
- [ ] Test verifies: Error state renders correctly when the mock `/api/events` stream sends an error event
- [ ] Tests are in `dashboard/tests/e2e/live-analysis.spec.ts`

## Design

**Files expected to change:**

- `dashboard/tests/e2e/live-analysis.spec.ts` — new, full analysis flow test
- `dashboard/tests/e2e/helpers/mock-sse.ts` — new, MSW or Playwright route handler that replays SSE events
- `dashboard/tests/fixtures/sse-events.json` — new, scripted SSE event sequence

**Approach:**

The dashboard's live analysis flow uses TWO separate API endpoints:
1. `POST /api/run` — starts the analysis, returns JSON `{ ok: true }` immediately
2. `GET /api/events` — opens an SSE stream (EventSource) that receives `StepEvent` objects

Use Playwright's `page.route()` to intercept BOTH:
- `/api/run` → respond with `{ ok: true }` (JSON, not SSE)
- `/api/events` → respond with `text/event-stream` Content-Type, replay events from `sse-events.json` with 20-50ms delays between events

Events follow the real `StepEvent` type from `dashboard/src/lib/agentSession.ts`:
- `{ type: 'tool_call', name: string, args: object }`
- `{ type: 'record_finding', finding: { id, title, severity, category } }`
- `{ type: 'run_complete', result: { scorecard, metrics } }`

The `/api/events` route also replays accumulated events on reconnect, so the mock should handle multiple GET requests by replaying all events from the start.

Test the happy path (analysis completes) and error path (stream sends error event mid-flow).
Use `page.waitForSelector()` with 10s timeouts for state transitions.

**Out of scope:** Real LLM calls (this is fully mocked), budget pause flow (edge case for later), multi-goal runs.

## Tasks

1. Create `dashboard/tests/fixtures/sse-events.json` with a 12-event sequence: 5 `tool_call` events (list_directory, parse_package_json, read_file, analyze_component_directives, check_gitignore), 4 `record_finding` events with varying severity, 1 `specialist_result` event, 1 `status` event, 1 `run_complete` event with scorecard/metrics
2. Create `dashboard/tests/e2e/helpers/mock-sse.ts` that exports a `setupMockRoutes(page)` function using `page.route()` to intercept: POST `/api/run` → JSON `{ ok: true }`, GET `/api/events` → SSE stream replaying events with 30ms delay
3. Write happy-path test: navigate to dashboard, trigger analysis via UI, assert running state appears, wait for events to stream, assert completion view shows scorecard and 4 findings
4. Write error-path test: mock `/api/events` to send 3 events then an error event → assert error UI renders with message
5. Write state-transition test: verify status transitions idle → running → complete by checking DOM state at each phase
6. Run and verify all assertions pass

## Verification

- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/live-analysis.spec.ts`
- [assert] `cd dashboard && npx playwright test tests/e2e/live-analysis.spec.ts --reporter=list 2>&1 | grep -c "passed"` outputs at least 3
