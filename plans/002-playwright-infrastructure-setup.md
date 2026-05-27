---
id: 002
title: Playwright infrastructure setup
status: done
completed: 2026-05-27
reviewed: false
qa: automated
blocked-by: []
needs-review: none
created: 2026-05-27
---

## Requirements

The dashboard (Next.js 16 app in `dashboard/`) has zero browser-based testing. Developers cannot verify that pages render, interactions work, or regressions occur without manual checking. This plan adds Playwright as the browser testing framework with proper configuration for the Next.js dashboard.

**Acceptance criteria:**

- [ ] Playwright is installed as a devDependency in `dashboard/package.json`
- [ ] `playwright.config.ts` exists in `dashboard/` with: baseURL pointing to local dev server, chromium + firefox projects, screenshot-on-failure, HTML reporter
- [ ] `webServer` config in playwright starts the Next.js dev server automatically before tests
- [ ] A `pnpm test:e2e` script exists in `dashboard/package.json` that runs Playwright
- [ ] A smoke test (`tests/e2e/smoke.spec.ts`) loads the root page and asserts no console errors and a 200 status
- [ ] `.gitignore` updated to exclude `test-results/`, `playwright-report/`, `blob-report/`
- [ ] Root `package.json` gets a `test:playwright` script that delegates to `pnpm --filter ./dashboard test:e2e`

## Design

**Files expected to change:**

- `dashboard/package.json` — add `@playwright/test` devDep, add `test:e2e` script
- `dashboard/playwright.config.ts` — new file, full Playwright config
- `dashboard/tests/e2e/smoke.spec.ts` — new file, minimal smoke test
- `dashboard/.gitignore` — add Playwright output dirs
- `package.json` — add root-level `test:playwright` script

**Approach:**

- Use `@playwright/test` (not the library mode) for full test runner features
- Configure `webServer` to run `pnpm dev` with `reuseExistingServer: true` so CI starts fresh but local dev reuses running server
- Set `timeout: 30000` per test (Next.js cold start can be slow)
- Use project-scoped `testDir: './tests/e2e'` to keep Playwright tests separate from Vitest unit tests

**Out of scope:** Writing comprehensive tests (that's plans 003-005), CI pipeline (plan 009), visual regression (plan 008).

## Tasks

1. Install `@playwright/test` and browsers in `dashboard/`
2. Create `dashboard/playwright.config.ts` with webServer, projects, reporter config
3. Create `dashboard/tests/e2e/smoke.spec.ts` with basic page load assertion
4. Update `dashboard/.gitignore` with Playwright output directories
5. Add `test:e2e` script to `dashboard/package.json`
6. Add `test:playwright` script to root `package.json`
7. Run the smoke test to verify the setup works end-to-end

## Verification

- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/smoke.spec.ts`
- [assert] `cd dashboard && npx playwright test --list` output contains `smoke.spec.ts`
- [cmd] `cd dashboard && npx playwright test --project=chromium --reporter=list 2>&1 | grep -q "passed"`
