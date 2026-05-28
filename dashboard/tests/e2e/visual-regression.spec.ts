/**
 * Visual Regression Tests — Golden baseline screenshots for key dashboard views.
 *
 * These tests use Playwright's built-in `toHaveScreenshot()` for pixel-level
 * visual comparison against committed baseline images.
 *
 * HOW TO UPDATE BASELINES:
 *   pnpm test:visual --update-snapshots
 *
 * This regenerates all golden screenshots. Review the diff before committing.
 *
 * HOW TO RUN:
 *   pnpm test:visual
 *
 * Configuration:
 *   - maxDiffPixelRatio: 0.002 (0.2% pixel tolerance for anti-aliasing)
 *   - animations: disabled (frozen CSS animations/transitions)
 *   - Viewport: 1280x800 (desktop)
 *   - Dynamic content (timestamps, UUIDs) is masked
 */

import { test, expect } from '@playwright/test';

// Common screenshot options applied to all visual assertions
const screenshotOptions = {
  animations: 'disabled' as const,
  maxDiffPixelRatio: 0.002,
};

test.describe('Visual regression — golden baselines', () => {
  test.beforeEach(async ({ page }) => {
    // Set consistent desktop viewport for all visual tests
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('runs list view', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Runs view via sidebar
    const runsNav = page.locator('button[aria-label="Runs"]');
    await expect(runsNav).toBeVisible();
    await runsNav.click();

    // Wait for the runs list to render
    await page.waitForLoadState('networkidle');
    const runsHeading = page.locator('text=Run History');
    await expect(runsHeading).toBeVisible({ timeout: 5000 });

    // Mask dynamic content: timestamps (time elements and ISO-date-like text)
    const masks = [
      page.locator('time'),
      page.locator('[data-testid="run-id"]'),
      page.locator('[data-testid="uptime"]'),
    ];

    await expect(page).toHaveScreenshot('runs-list-view.png', {
      ...screenshotOptions,
      fullPage: true,
      mask: masks,
    });
  });

  test('run detail view — scorecard and findings', async ({ page }) => {
    // Navigate directly to a seeded fixture run
    await page.goto('/fixture-audit-001');
    await page.waitForLoadState('networkidle');

    // Wait for the dashboard container to appear
    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible({ timeout: 10000 });

    // Mask dynamic content
    const masks = [
      page.locator('time'),
      page.locator('[data-testid="run-id"]'),
      page.locator('[data-testid="uptime"]'),
    ];

    await expect(page).toHaveScreenshot('run-detail-view.png', {
      ...screenshotOptions,
      fullPage: true,
      mask: masks,
    });
  });

  test('dashboard home view', async ({ page }) => {
    // The root page with seeded data shows the dashboard overview
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const dashboard = page.locator('[data-component="DashboardPage"]');
    await expect(dashboard).toBeVisible({ timeout: 5000 });

    // Mask dynamic content
    const masks = [
      page.locator('time'),
      page.locator('[data-testid="run-id"]'),
      page.locator('[data-testid="uptime"]'),
    ];

    await expect(page).toHaveScreenshot('dashboard-home-view.png', {
      ...screenshotOptions,
      fullPage: true,
      mask: masks,
    });
  });

  test('how-it-works page', async ({ page }) => {
    await page.goto('/how-it-works');
    await page.waitForLoadState('networkidle');

    const howItWorks = page.locator('[data-component="HowItWorksPage"]');
    await expect(howItWorks).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('how-it-works-page.png', {
      ...screenshotOptions,
      fullPage: true,
    });
  });
});
