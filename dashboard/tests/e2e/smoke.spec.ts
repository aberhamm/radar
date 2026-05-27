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
});
