---
id: 007
title: API route integration tests
status: pending
blocked-by: [002]
needs-review: none
created: 2026-05-27
---

## Requirements

The dashboard exposes 15+ API routes (`/api/health`, `/api/repos`, `/api/run`, `/api/history`, `/api/events`, `/api/export-pdf`, etc.) that are currently untested as HTTP endpoints. Unit tests exist for some transform logic, but no tests verify the routes respond correctly to HTTP requests with proper status codes, headers, and response shapes. This plan adds integration tests hitting routes directly.

**Acceptance criteria:**

- [ ] Integration tests hit each API route as an HTTP request (not importing the handler function)
- [ ] Tests verify: correct HTTP status codes (200, 400, 404, 405 as appropriate)
- [ ] Tests verify: response Content-Type headers (application/json, text/event-stream, application/pdf)
- [ ] Tests verify: response body shape matches expected schema (required fields present, correct types)
- [ ] Tests verify: error responses include meaningful error messages
- [ ] Tests cover at least: `/api/health`, `/api/repos`, `/api/history`, `/api/rules`, `/api/session`, `/api/detect-roots`, `/api/compare`, `/api/export-pdf`, `/api/changelog`
- [ ] Tests run via Vitest (not Playwright) using `fetch()` against the running dev server
- [ ] Tests are in `test/dashboard/api-routes.test.ts`

## Design

**Files expected to change:**

- `test/dashboard/api-routes.test.ts` — new, comprehensive API route tests
- `test/dashboard/helpers/startServer.ts` — new (optional), helper to start/stop Next.js for tests

**Approach:**

- Use Vitest with `beforeAll` that starts the Next.js dev server on a random port (use `getPort()` or hardcode 3099 to avoid conflicts), or reuses a running server if port is already bound
- Use native `fetch()` to hit `http://localhost:<port>/api/...`
- Seed fixture data: create `dashboard/output/runs/fixture-api-test/` with envelope.json, findings.json, events.json before tests (same schema as plan 003 fixtures)
- Test both success cases (valid requests) and error cases (missing params, bad methods)
- Group tests by route. Use `describe` blocks per route.
- `startServer.ts` helper: spawn `next dev --port <port>` via `child_process.spawn`, wait for `"Ready"` stdout, return port + kill function

**Routes to test (10 primary routes — covers the core API surface):**
- `GET /api/health` — 200, `{ status: 'ok', uptime: number, timestamp: string }`
- `GET /api/repos` — 200, `{ repos: [...] }`
- `GET /api/history` — 200, array with at least 1 fixture entry
- `GET /api/rules` — 200, object with rule names
- `GET /api/session` — 200, `{ status: string, history: [...] }`
- `GET /api/detect-roots?repo=<path>` — 200 with roots or 400 without param
- `GET /api/compare?repos=<path1>,<path2>` — 200 with comparison or 400
- `GET /api/export-pdf?run=fixture-api-test` — 200 with `application/pdf` Content-Type or 400
- `GET /api/changelog` — 200 with changelog array
- `POST /api/run` — 400 without required body fields (don't trigger actual analysis)

**Explicitly out of scope (21 total routes exist, testing 10):**
- `/api/history/[id]`, `/api/history/[id]/findings`, `/api/history/[id]/events` — dynamic routes tested implicitly via history listing
- `/api/events` — SSE streaming tested in plan 005
- `/api/clone`, `/api/demo`, `/api/extend-budget`, `/api/create-issues` — mutation routes that require complex setup
- Auth (no auth layer currently)

**Out of scope:** Testing the actual agent execution (that's the existing e2e tests), SSE streaming behavior (plan 005).

## Tasks

1. Create `test/dashboard/helpers/startServer.ts` with dev server lifecycle management
2. Write health route test
3. Write repos route test
4. Write history route test with fixture data
5. Write remaining route tests (rules, session, detect-roots, compare, export-pdf, changelog)
6. Write error case tests (bad methods, missing params)
7. Run full suite and verify all pass

## Verification

- [cmd] `pnpm test:unit test/dashboard/api-routes.test.ts`
- [assert] `pnpm vitest run test/dashboard/api-routes.test.ts 2>&1 | grep "Tests"` shows all passed
