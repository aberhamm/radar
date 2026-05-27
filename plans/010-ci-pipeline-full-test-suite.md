---
id: 010
title: CI pipeline for full test suite
status: pending
blocked-by: [002, 003, 004, 005, 006, 007, 008, 009]
needs-review: none
created: 2026-05-27
---

## Requirements

All testing layers (Vitest unit, API integration, Playwright E2E, visual regression) need to run automatically on every PR and push to main. This plan creates a GitHub Actions workflow that orchestrates the full test suite with proper caching, parallelism, and artifact uploads for failure debugging.

**Acceptance criteria:**

- [ ] `.github/workflows/test.yml` runs on: push to main, pull_request to main
- [ ] Pipeline stages execute in order: typecheck → unit tests → API integration → Playwright E2E → visual regression
- [ ] Playwright tests run with browser binaries cached (GitHub Actions cache)
- [ ] On failure: Playwright HTML report and screenshots uploaded as artifacts
- [ ] On failure: test output clearly identifies which stage failed
- [ ] Pipeline passes when all tests pass (exit 0)
- [ ] Pipeline fails fast: if typecheck fails, skip subsequent stages
- [ ] Total pipeline time target: under 5 minutes for a typical PR

## Design

**Files expected to change:**

- `.github/workflows/test.yml` — new, full test pipeline
- `package.json` — possibly add a `test:all` convenience script

**Approach:**

- Use a single job with sequential steps (simpler than matrix for a small project)
- Cache: `node_modules` via `actions/setup-node` cache, Playwright browsers via `actions/cache` with `~/.cache/ms-playwright` key
- Steps: checkout → setup-node → install deps → build (`tsc`) → typecheck → vitest unit → vitest API integration → playwright E2E → playwright visual
- Use `if: success()` to skip downstream steps on failure
- Upload `playwright-report/` and `test-results/` as artifacts on failure
- Set `NEXT_PUBLIC_*` env vars needed for dashboard to boot

**Pipeline structure:**
```
1. Checkout + setup
2. Install (pnpm install, playwright install chromium)
3. Build (tsc)
4. Typecheck (tsc --noEmit on dashboard)
5. Unit tests (pnpm test:unit)
6. API integration (pnpm vitest run test/dashboard/api-routes.test.ts)
7. Playwright E2E (cd dashboard && npx playwright test --project=chromium)
8. Visual regression (cd dashboard && npx playwright test tests/e2e/visual-regression.spec.ts)
9. Upload artifacts on failure
```

**Out of scope:** Deployment (separate workflow), performance benchmarking in CI, cross-browser matrix (keep it fast with chromium only), code coverage reporting.

## Tasks

1. Create `.github/workflows/test.yml` with full pipeline
2. Configure caching for node_modules and Playwright browsers
3. Add artifact upload step for Playwright reports on failure
4. Add `test:all` script to root `package.json` for local convenience
5. Test the workflow by pushing to a feature branch
6. Verify pipeline passes end-to-end

## Verification

- [cmd] `act -j test --dryrun` (if `act` is installed) or validate YAML syntax
- [assert] `cat .github/workflows/test.yml | grep "playwright" | wc -l` outputs at least 2
- [cmd] `yamllint .github/workflows/test.yml 2>/dev/null || python -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`
