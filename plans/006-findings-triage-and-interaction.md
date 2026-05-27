---
id: 006
title: Findings triage and interaction E2E tests
status: done
completed: 2026-05-27
reviewed: false
qa: automated
blocked-by: [004, 005]
needs-review: none
created: 2026-05-27
---

## Requirements

The findings triage UI is the primary interaction surface for users reviewing analysis results. It includes filtering by severity, opening detail panels, viewing evidence, and exporting reports. This plan adds E2E tests covering these interaction flows to catch regressions in the triage experience.

**Acceptance criteria:**

- [ ] Test verifies: findings list renders all findings from fixture data with correct severity badges
- [ ] Test verifies: clicking a finding opens the FindingDetailPanel with evidence, file path, and description
- [ ] Test verifies: severity filter buttons correctly show/hide findings (e.g., filter to "high" only)
- [ ] Test verifies: FindingDetailPanel close button returns to the list view
- [ ] Test verifies: PDF export button is present and clickable (doesn't need to verify PDF content)
- [ ] Test verifies: scorecard section displays all categories with color-coded scores
- [ ] Tests are in `dashboard/tests/e2e/findings-triage.spec.ts`

## Design

**Files expected to change:**

- `dashboard/tests/e2e/findings-triage.spec.ts` — new, interaction test suite

**Approach:**

- Tests use the pre-seeded fixture data (from plan 003) which includes findings with mixed severities
- Use `page.getByRole()` and `page.getByTestId()` for robust selectors
- Test filtering by clicking severity badge buttons and asserting visible finding count changes
- Test detail panel by clicking a finding row and asserting panel content matches fixture data
- PDF export test only verifies the button click triggers (doesn't assert PDF content — that's unit tested elsewhere)

**Out of scope:** PDF content verification (covered by `test/output/pdfExport.test.ts`), GitHub Issues creation flow (requires auth), comparison view.

## Tasks

1. Write findings list rendering test (count matches fixture, severity badges visible)
2. Write detail panel open/close test
3. Write severity filter interaction test
4. Write scorecard display test
5. Write PDF export button test
6. Run full suite against fixture data

## Verification

- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/findings-triage.spec.ts`
- [assert] `cd dashboard && npx playwright test tests/e2e/findings-triage.spec.ts --reporter=list 2>&1 | grep -c "passed"` outputs at least 5
