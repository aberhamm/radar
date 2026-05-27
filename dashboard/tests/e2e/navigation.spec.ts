import { test, expect } from '@playwright/test';
import { noConsoleErrors, pageLoads, setBreakpoint } from './helpers/assertions';

// ─── Direct URL Route Access ────────────────────────────────────────────────

test.describe('Direct URL route access', () => {
  test('root page (/) loads without errors', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    // The root should display either runs list or the idle view
    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    assertNoErrors();
  });

  test('run detail page (/fixture-audit-001) loads without errors', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/fixture-audit-001');
    await page.waitForLoadState('networkidle');

    // The page should show the dashboard container
    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    assertNoErrors();
  });

  test('how-it-works page (/how-it-works) loads without errors', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/how-it-works');
    await page.waitForLoadState('networkidle');

    // Should render the HowItWorksPage component
    const howItWorks = page.locator('[data-component="HowItWorksPage"]');
    await expect(howItWorks).toBeVisible();

    // Should have the "radar" brand in the header
    const brand = page.locator('header >> text=radar');
    await expect(brand).toBeVisible();

    assertNoErrors();
  });

  test('how-it-works page has correct heading content', async ({ page }) => {
    await pageLoads(page, '/how-it-works');
    await page.waitForLoadState('networkidle');

    // The page should contain architecture layer names
    const body = await page.textContent('body');
    expect(body).toContain('Consulting Rules');
    expect(body).toContain('Pi Agent Runtime');
  });
});

// ─── Sidebar Navigation ────────────────────────────────────────────────────

test.describe('Sidebar navigation', () => {
  test('clicking Dashboard nav item navigates to idle/home view', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    // Start on a different page (how-it-works uses its own layout without sidebar,
    // so navigate to root then use sidebar)
    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    // Click the Dashboard nav item in the sidebar
    const dashboardNav = page.locator('button[aria-label="Dashboard"]');
    await expect(dashboardNav).toBeVisible();
    await dashboardNav.click();

    // Should be on the dashboard/idle view
    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    // Dashboard button should be marked as current page
    await expect(dashboardNav).toHaveAttribute('aria-current', 'page');

    assertNoErrors();
  });

  test('clicking Runs nav item navigates to runs list view', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    // Click the Runs nav item
    const runsNav = page.locator('button[aria-label="Runs"]');
    await expect(runsNav).toBeVisible();
    await runsNav.click();

    // The Runs button should now be the active section
    await expect(runsNav).toHaveAttribute('aria-current', 'page');

    // Should show the runs heading
    const runsHeading = page.locator('text=Run History');
    await expect(runsHeading).toBeVisible({ timeout: 5000 });

    assertNoErrors();
  });

  test('clicking Findings nav item navigates to findings view', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    // Click the Findings nav item
    const findingsNav = page.locator('button[aria-label="Findings"]');
    await expect(findingsNav).toBeVisible();
    await findingsNav.click();

    // The Findings button should now be the active section
    await expect(findingsNav).toHaveAttribute('aria-current', 'page');

    assertNoErrors();
  });

  test('clicking Settings nav item navigates to settings view', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    // Click the Settings nav item
    const settingsNav = page.locator('button[aria-label="Settings"]');
    await expect(settingsNav).toBeVisible();
    await settingsNav.click();

    // The Settings button should now be the active section
    await expect(settingsNav).toHaveAttribute('aria-current', 'page');

    // Should show the settings heading
    const settingsHeading = page.getByRole('heading', { name: 'Settings' });
    await expect(settingsHeading).toBeVisible({ timeout: 5000 });

    assertNoErrors();
  });
});

// ─── Responsive Viewport Tests ──────────────────────────────────────────────

test.describe('Responsive breakpoints', () => {
  test('root page renders at desktop viewport (1280px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'desktop');
    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    // Sidebar should be visible at desktop width
    const sidebar = page.locator('[data-component="AppSidebar"]');
    await expect(sidebar).toBeVisible();

    assertNoErrors();
  });

  test('root page renders at tablet viewport (768px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'tablet');
    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    assertNoErrors();
  });

  test('root page renders at mobile viewport (375px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'mobile');
    await pageLoads(page, '/');
    await page.waitForLoadState('networkidle');

    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible();

    // Mobile brand text should be visible (sidebar hidden by default on mobile)
    const mobileBrand = page.locator('header >> text=radar');
    await expect(mobileBrand).toBeVisible();

    assertNoErrors();
  });

  test('how-it-works page renders at desktop viewport (1280px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'desktop');
    await pageLoads(page, '/how-it-works');
    await page.waitForLoadState('networkidle');

    const howItWorks = page.locator('[data-component="HowItWorksPage"]');
    await expect(howItWorks).toBeVisible();

    assertNoErrors();
  });

  test('how-it-works page renders at tablet viewport (768px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'tablet');
    await pageLoads(page, '/how-it-works');
    await page.waitForLoadState('networkidle');

    const howItWorks = page.locator('[data-component="HowItWorksPage"]');
    await expect(howItWorks).toBeVisible();

    assertNoErrors();
  });

  test('how-it-works page renders at mobile viewport (375px)', async ({ page }) => {
    const assertNoErrors = noConsoleErrors(page);

    await setBreakpoint(page, 'mobile');
    await pageLoads(page, '/how-it-works');
    await page.waitForLoadState('networkidle');

    const howItWorks = page.locator('[data-component="HowItWorksPage"]');
    await expect(howItWorks).toBeVisible();

    assertNoErrors();
  });
});
