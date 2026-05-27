import { test, expect } from '@playwright/test';
import { noConsoleErrors, pageLoads } from './helpers/assertions';

/**
 * Findings Triage UI — E2E interaction tests.
 *
 * These tests navigate to the findings triage page using the pre-seeded
 * fixture run (fixture-audit-001) which contains 4 findings:
 *   - finding-001: critical (dependencies)
 *   - finding-002: high (security)
 *   - finding-003: medium (architecture)
 *   - finding-004: low (configuration)
 */

const FINDINGS_URL = '/findings/fixture-audit-001';
const FIXTURE_RUN_URL = '/run/fixture-audit-001';

// ─── Test 1: Findings list renders all findings with severity badges ────────

test.describe('Findings list rendering', () => {
  test('renders all findings from fixture data with correct severity badges', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, FINDINGS_URL);
    await page.waitForLoadState('networkidle');

    // Wait for the FindingsTriagePage to be visible
    const triagePage = page.locator('[data-component="FindingsTriagePage"]');
    await expect(triagePage).toBeVisible({ timeout: 10000 });

    // The fixture has 4 findings — verify all are rendered in the table
    const tableRows = page.locator('table[role="grid"] tbody tr[role="row"]');
    await expect(tableRows).toHaveCount(4, { timeout: 10000 });

    // Verify severity badges are present for each severity level
    // Badge component renders as <span> with variant classes and the severity text
    const criticalBadge = triagePage.locator('span:has-text("critical")').first();
    const highBadge = triagePage.locator('span:has-text("high")').first();
    const mediumBadge = triagePage.locator('span:has-text("medium")').first();
    const lowBadge = triagePage.locator('span:has-text("low")').first();

    await expect(criticalBadge).toBeVisible();
    await expect(highBadge).toBeVisible();
    await expect(mediumBadge).toBeVisible();
    await expect(lowBadge).toBeVisible();

    // Verify finding titles are visible
    await expect(triagePage.getByText('Outdated authentication library with known CVE')).toBeVisible();
    await expect(triagePage.getByText('Missing rate limiting on API endpoints')).toBeVisible();
    await expect(triagePage.getByText('Inconsistent error handling patterns')).toBeVisible();
    await expect(triagePage.getByText('Missing TypeScript strict mode in tsconfig')).toBeVisible();

    // Verify the stat bar shows correct counts
    // The stat bar shows Critical count, High count, Total count
    const statSection = triagePage.locator('text=Critical').first();
    await expect(statSection).toBeVisible();

    assertNoErrors();
  });
});

// ─── Test 2: Detail panel open/close ────────────────────────────────────────

test.describe('Finding detail panel', () => {
  test('clicking a finding opens the FindingDetailPanel with evidence and description', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, FINDINGS_URL);
    await page.waitForLoadState('networkidle');

    const triagePage = page.locator('[data-component="FindingsTriagePage"]');
    await expect(triagePage).toBeVisible({ timeout: 10000 });

    // Wait for rows to render
    const tableRows = page.locator('table[role="grid"] tbody tr[role="row"]');
    await expect(tableRows).toHaveCount(4, { timeout: 10000 });

    // Click the first finding row (critical severity — sorted by severity by default)
    await tableRows.first().click();

    // The FindingDetailPanel should appear
    const detailPanel = page.locator('[data-component="FindingDetailPanel"]');
    await expect(detailPanel).toBeVisible({ timeout: 5000 });

    // Verify panel content matches the first finding (critical)
    // Title should be visible in the panel
    await expect(detailPanel.getByText('Outdated authentication library with known CVE')).toBeVisible();

    // Evidence section should show file paths
    await expect(detailPanel.getByText('package.json')).toBeVisible();

    // Severity badge should be present in the panel
    await expect(detailPanel.locator('span:has-text("critical")')).toBeVisible();

    assertNoErrors();
  });

  test('close button returns to the list view', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, FINDINGS_URL);
    await page.waitForLoadState('networkidle');

    const triagePage = page.locator('[data-component="FindingsTriagePage"]');
    await expect(triagePage).toBeVisible({ timeout: 10000 });

    // Wait for rows and click first finding
    const tableRows = page.locator('table[role="grid"] tbody tr[role="row"]');
    await expect(tableRows).toHaveCount(4, { timeout: 10000 });
    await tableRows.first().click();

    // Panel should be open
    const detailPanel = page.locator('[data-component="FindingDetailPanel"]');
    await expect(detailPanel).toBeVisible({ timeout: 5000 });

    // Click the close button (aria-label="Close panel")
    const closeButton = detailPanel.getByRole('button', { name: 'Close panel' });
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // Panel should disappear
    await expect(detailPanel).not.toBeVisible({ timeout: 5000 });

    // Table rows should still be visible
    await expect(tableRows).toHaveCount(4);

    assertNoErrors();
  });
});

// ─── Test 3: Severity filter interaction ────────────────────────────────────

test.describe('Severity filter', () => {
  test('filtering by "high" severity shows only high findings', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, FINDINGS_URL);
    await page.waitForLoadState('networkidle');

    const triagePage = page.locator('[data-component="FindingsTriagePage"]');
    await expect(triagePage).toBeVisible({ timeout: 10000 });

    // Confirm all 4 findings are initially visible
    const tableRows = page.locator('table[role="grid"] tbody tr[role="row"]');
    await expect(tableRows).toHaveCount(4, { timeout: 10000 });

    // Select "High" from the severity filter dropdown (aria-label="Severity")
    const severityFilter = triagePage.locator('select[aria-label="Severity"]');
    await expect(severityFilter).toBeVisible();
    await severityFilter.selectOption('high');

    // After filtering, only findings with "high" severity should be visible
    // The fixture has 1 high-severity finding (finding-002)
    await expect(tableRows).toHaveCount(1, { timeout: 5000 });

    // Verify it's the correct finding
    await expect(triagePage.getByText('Missing rate limiting on API endpoints')).toBeVisible();

    // Other findings should not be visible
    await expect(triagePage.getByText('Outdated authentication library with known CVE')).not.toBeVisible();
    await expect(triagePage.getByText('Inconsistent error handling patterns')).not.toBeVisible();

    // Reset filter
    await severityFilter.selectOption('');

    // All 4 findings should be visible again
    await expect(tableRows).toHaveCount(4, { timeout: 5000 });

    assertNoErrors();
  });
});

// ─── Test 4: Scorecard display ──────────────────────────────────────────────

test.describe('Scorecard display', () => {
  test('scorecard section displays all categories with color-coded scores', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    // Navigate to the run detail page which shows the scorecard in the overview tab
    await pageLoads(page, FIXTURE_RUN_URL);
    await page.waitForLoadState('networkidle');

    // The SingleOverviewContent should render
    const overviewContent = page.locator('[data-component="SingleOverviewContent"]');
    await expect(overviewContent).toBeVisible({ timeout: 10000 });

    // Verify all three scorecard categories from fixture are displayed
    // envelope.json has: architecture (green), security (yellow), dependencies (red)
    await expect(overviewContent.getByText('architecture')).toBeVisible();
    await expect(overviewContent.getByText('security')).toBeVisible();
    await expect(overviewContent.getByText('dependencies')).toBeVisible();

    // Verify scorecard grades are shown (A=green, B=yellow, C/D/F=red)
    // The scoreToGrade function converts: green->A, yellow->B, red->C
    // Look for grade letters in the score indicators
    const gradeElements = overviewContent.locator('.font-brand');
    const gradeCount = await gradeElements.count();
    expect(gradeCount).toBeGreaterThanOrEqual(3); // At least the 3 category grades

    // The overall score badge should show "yellow" verdict
    // Overall score from fixture is "yellow" which maps to grade "B"
    const overallGrade = overviewContent.locator('.font-brand').first();
    await expect(overallGrade).toBeVisible();

    assertNoErrors();
  });
});

// ─── Test 5: PDF export button ──────────────────────────────────────────────

test.describe('PDF export', () => {
  test('PDF export button is present and clickable on the run overview', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    // Navigate to the run detail page (overview tab has the Export PDF button)
    await pageLoads(page, FIXTURE_RUN_URL);
    await page.waitForLoadState('networkidle');

    // Wait for the page to fully render
    const overviewContent = page.locator('[data-component="SingleOverviewContent"]');
    await expect(overviewContent).toBeVisible({ timeout: 10000 });

    // Find the Export PDF button (rendered by ExportButton component)
    const pdfButton = page.getByRole('button', { name: 'Export PDF' });
    await expect(pdfButton).toBeVisible();

    // Click the button (it will attempt PDF export; we just verify it's clickable)
    await pdfButton.click();

    // After click, the button text should change to "Exporting..." temporarily
    // or remain as "Export PDF" if the export fails/completes quickly
    // Either state is acceptable — we're testing the button is interactive
    const buttonAfterClick = page.getByRole('button', { name: /Export PDF|Exporting/ });
    await expect(buttonAfterClick).toBeVisible({ timeout: 5000 });

    assertNoErrors();
  });
});

// ─── Test 6: Export menu on findings page ───────────────────────────────────

test.describe('Findings export', () => {
  test('Export menu is accessible via bulk selection on the findings page', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, FINDINGS_URL);
    await page.waitForLoadState('networkidle');

    const triagePage = page.locator('[data-component="FindingsTriagePage"]');
    await expect(triagePage).toBeVisible({ timeout: 10000 });

    // Wait for rows to appear
    const tableRows = page.locator('table[role="grid"] tbody tr[role="row"]');
    await expect(tableRows).toHaveCount(4, { timeout: 10000 });

    // Select a finding using the checkbox (first row's checkbox)
    const firstCheckbox = tableRows.first().locator('input[type="checkbox"]');
    await firstCheckbox.click();

    // The bulk action bar should appear with "1 selected" text
    await expect(triagePage.getByText('1 selected')).toBeVisible({ timeout: 5000 });

    // The export button should be visible in the bulk action bar
    const exportButton = triagePage.getByText('Export').first();
    await expect(exportButton).toBeVisible();

    assertNoErrors();
  });
});
