import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('root page loads with 200 status and no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const response = await page.goto('/');

    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
    expect(consoleErrors).toEqual([]);
  });

  test('fixture runs appear in the run list', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to render content
    await page.waitForLoadState('networkidle');

    // The seeded fixture data should appear somewhere on the page
    // Check that the fixture repo name is visible
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('example-repo');
  });
});
