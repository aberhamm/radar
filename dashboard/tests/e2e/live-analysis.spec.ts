import { test, expect } from '@playwright/test';
import { setupMockRoutes, setupMockRoutesWithError } from './helpers/mock-sse';

/**
 * Live Analysis Flow E2E Tests
 *
 * Tests the critical user flow: trigger analysis -> SSE stream renders
 * real-time events -> run completes -> results display.
 *
 * All API endpoints are mocked via Playwright route interception so
 * no real LLM calls or backend processes are needed.
 */

test.describe('Live analysis flow', () => {
  test('happy path: triggers analysis, streams events, shows scorecard and findings', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The idle view should be visible with the repo input
    const idleView = page.locator('[data-component="IdleView"]');
    await expect(idleView).toBeVisible({ timeout: 10000 });

    // Fill in a local repo path (non-URL so it goes straight to "Start Analysis")
    const repoInput = page.locator('#repo-input');
    await repoInput.fill('/mock/test-repo');

    // Click "Start Analysis" button
    const startButton = page.locator('button[type="submit"]', { hasText: 'Start Analysis' });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // The UI should transition to running state — AnalysisView appears
    const analysisView = page.locator('[data-component="AnalysisView"]');
    await expect(analysisView).toBeVisible({ timeout: 10000 });

    // Wait for the run to complete — RunView should appear with scorecard
    const runView = page.locator('[data-component="RunView"]');
    await expect(runView).toBeVisible({ timeout: 15000 });

    // Verify scorecard is rendered — check for the overall score indicator
    // The scorecard should show "YELLOW" overall score from our mock data
    const scorecardContent = await runView.textContent();
    expect(scorecardContent).toContain('YELLOW');

    // Verify findings count matches the 4 record_finding events in the stream
    // The RunView shows findings — check the page contains references to our findings
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('Missing error boundary');
    expect(pageContent).toContain('Outdated dependency');
    expect(pageContent).toContain('No CSP headers configured');
    expect(pageContent).toContain('Client components overuse');
  });

  test('error path: stream sends error event, UI shows error state', async ({ page }) => {
    await setupMockRoutesWithError(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Fill repo path and start analysis
    const repoInput = page.locator('#repo-input');
    await repoInput.fill('/mock/test-repo');

    const startButton = page.locator('button[type="submit"]', { hasText: 'Start Analysis' });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // The UI should transition to running state first
    const analysisView = page.locator('[data-component="AnalysisView"]');
    await expect(analysisView).toBeVisible({ timeout: 10000 });

    // Then the error state should appear — the page shows
    // "Analysis could not complete" with a "Try Again" button
    const errorHeading = page.locator('text=Analysis could not complete');
    await expect(errorHeading).toBeVisible({ timeout: 15000 });

    // The friendly error message should reference timeout issues
    // (friendlyError maps "timeout" to a user-friendly message)
    const errorMessage = page.locator('text=timed out');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // "Try Again" button should be visible
    const tryAgainButton = page.locator('button', { hasText: 'Try Again' });
    await expect(tryAgainButton).toBeVisible();
  });

  test('state transitions: idle -> running -> complete', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // STATE 1: Idle — IdleView is visible, no AnalysisView or RunView
    const idleView = page.locator('[data-component="IdleView"]');
    await expect(idleView).toBeVisible({ timeout: 10000 });

    const analysisView = page.locator('[data-component="AnalysisView"]');
    await expect(analysisView).not.toBeVisible();

    const runView = page.locator('[data-component="RunView"]');
    await expect(runView).not.toBeVisible();

    // Trigger analysis
    const repoInput = page.locator('#repo-input');
    await repoInput.fill('/mock/test-repo');

    const startButton = page.locator('button[type="submit"]', { hasText: 'Start Analysis' });
    await startButton.click();

    // STATE 2: Running — AnalysisView is visible, IdleView is gone
    await expect(analysisView).toBeVisible({ timeout: 10000 });
    await expect(idleView).not.toBeVisible();

    // STATE 3: Complete — RunView is visible (the AnalysisView transitions to RunView)
    await expect(runView).toBeVisible({ timeout: 15000 });

    // The run view should contain scorecard data proving the run completed
    const pageContent = await runView.textContent();
    expect(pageContent).toContain('mock-repo');
  });
});
