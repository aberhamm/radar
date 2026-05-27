---
id: 004
title: Dashboard smoke and navigation E2E tests
status: pending
blocked-by: [003]
needs-review: none
created: 2026-05-27
---

## Requirements

With Playwright infrastructure and fixture data in place, this plan adds comprehensive smoke tests covering every dashboard route and the primary navigation flows. These catch rendering failures, broken links, and console errors across the full page set.

**Acceptance criteria:**

- [ ] Every dashboard route loads without throwing (no uncaught exceptions, no 500s)
- [ ] Sidebar navigation between all major views works (click nav item → correct page renders)
- [ ] No console errors on any page load (console error listener fails the test)
- [ ] Responsive breakpoints tested: desktop (1280px), tablet (768px), mobile (375px) — pages don't crash at any width
- [ ] Page titles/headings match expected values for each route
- [ ] Tests are organized in `dashboard/tests/e2e/navigation.spec.ts`

## Design

**Files expected to change:**

- `dashboard/tests/e2e/navigation.spec.ts` — new, comprehensive navigation test suite
- `dashboard/tests/e2e/helpers/assertions.ts` — new, shared assertion helpers (noConsoleErrors, pageLoads)

**Approach:**

- Use `page.on('console', ...)` listener to capture and fail on `error` level console messages
- Test each route by navigating directly (URL) and via sidebar click
- Use `page.setViewportSize()` for responsive checks
- Group tests by: direct URL access, sidebar navigation, responsive behavior

**Routes to test:**
- `/` (root — runs list or idle view)
- `/[[...slug]]` with a fixture run slug (run detail view)
- `/how-it-works` (static page)
- API routes return JSON, not HTML — tested in plan 006

**Out of scope:** Interactive behavior (plan 005), SSE streaming (plan 004-live), visual regression (plan 008).

## Tasks

1. Create `dashboard/tests/e2e/helpers/assertions.ts` with `expectNoConsoleErrors` and `expectPageLoads` utilities
2. Write `navigation.spec.ts` with route-load tests for every page
3. Add sidebar navigation flow tests (click item → verify URL + page content)
4. Add responsive viewport tests (3 breakpoints × critical pages)
5. Run full suite, fix any discovered issues

## Verification

- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/navigation.spec.ts`
- [assert] `cd dashboard && npx playwright test --project=chromium tests/e2e/navigation.spec.ts --reporter=list 2>&1 | grep "passed"` shows all tests passed
- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/navigation.spec.ts --reporter=json 2>&1 | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.suites[0].specs.length >= 10 ? 0 : 1)"`
