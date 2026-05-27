---
id: 009
title: Visual regression baseline
status: in-progress
blocked-by: [004]
needs-review: none
created: 2026-05-27
---

## Requirements

UI regressions often aren't caught by functional tests — a button might work but look broken. This plan adds Playwright's built-in visual comparison (screenshot diffing) to establish golden baselines for key dashboard views and catch unintended visual changes in future PRs.

**Acceptance criteria:**

- [ ] Golden baseline screenshots captured for: runs list view, run detail view (scorecard + findings), idle view, how-it-works page
- [ ] Screenshots taken at desktop (1280x800) resolution with consistent viewport
- [ ] `toHaveScreenshot()` assertions compare against baselines with configurable threshold (0.2% pixel diff allowed)
- [ ] A `pnpm test:visual` script runs only the visual regression tests
- [ ] Baseline screenshots committed to `dashboard/tests/e2e/__screenshots__/` (or Playwright's default location)
- [ ] Instructions in a test file comment explain how to update baselines (`--update-snapshots`)
- [ ] Tests are in `dashboard/tests/e2e/visual-regression.spec.ts`

## Design

**Files expected to change:**

- `dashboard/tests/e2e/visual-regression.spec.ts` — new, screenshot comparison tests
- `dashboard/tests/e2e/visual-regression.spec.ts-snapshots/` — new directory, golden baselines (auto-generated)
- `dashboard/package.json` — add `test:visual` script
- `dashboard/playwright.config.ts` — add snapshot configuration (threshold, update mode)

**Approach:**

- Use Playwright's native `expect(page).toHaveScreenshot()` (built-in, no external deps)
- Set `maxDiffPixelRatio: 0.002` for tolerance against anti-aliasing differences
- Take full-page screenshots for layout views, element screenshots for specific components
- Use `page.waitForLoadState('networkidle')` before screenshots to avoid capturing loading states
- Mask dynamic content using Playwright's `mask` option with these selectors:
  - `time` elements (all timestamps)
  - `[data-testid="run-id"]` or elements containing run UUIDs (use `page.locator('text=/[a-f0-9-]{36}/')`)
  - `[data-testid="uptime"]` or similar live counters
  - If no `data-testid` attributes exist, use CSS selectors targeting timestamp-pattern text (e.g., elements matching ISO date patterns)
- Use `animations: 'disabled'` in screenshot options to freeze CSS animations/transitions
- Set consistent system font rendering: use Playwright's `--font-render-hinting=none` launch arg

**Out of scope:** Component-level Storybook visual testing (over-engineering for this project), cross-browser visual comparison (chromium only for baselines), CI integration (plan 010).

## Tasks

1. Add snapshot config to `playwright.config.ts` (threshold, snapshot path)
2. Write visual regression tests for 4 key views
3. Add masking for dynamic content (timestamps, IDs)
4. Generate initial golden baselines by running with `--update-snapshots`
5. Add `test:visual` script to `dashboard/package.json`
6. Verify tests pass against the baselines they just generated

## Verification

- [cmd] `cd dashboard && npx playwright test tests/e2e/visual-regression.spec.ts --project=chromium`
- [assert] `ls dashboard/tests/e2e/visual-regression.spec.ts-snapshots/ | wc -l` outputs at least 4
- [cmd] `cd dashboard && npx playwright test tests/e2e/visual-regression.spec.ts --project=chromium --reporter=list 2>&1 | grep "passed"`
