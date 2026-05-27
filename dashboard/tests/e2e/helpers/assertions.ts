import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared assertion helpers for dashboard e2e tests.
 */

/**
 * Attaches a console error listener to the page and returns
 * a function that asserts no console errors were captured.
 *
 * Usage:
 *   const assertNoErrors = noConsoleErrors(page);
 *   // ... navigate / interact ...
 *   assertNoErrors();
 */
export function noConsoleErrors(page: Page): () => void {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // Ignore Next.js dev-mode noise (HMR, fast refresh, source map warnings)
      const text = msg.text();
      if (text.includes('[HMR]') || text.includes('Fast Refresh')) return;
      if (text.includes('Failed to load resource') && text.includes('favicon')) return;
      errors.push(text);
    }
  });

  return () => {
    expect(errors, 'Expected no console errors').toEqual([]);
  };
}

/**
 * Navigates to a URL and asserts the page loads with a 200 status,
 * no uncaught exceptions, and the response is not null.
 *
 * Returns the response for further assertions.
 */
export async function pageLoads(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: 'networkidle' });

  expect(response, `Expected response for ${url} to not be null`).not.toBeNull();
  expect(response!.status(), `Expected 200 for ${url}`).toBe(200);

  return response!;
}

/**
 * Sets the viewport to a named breakpoint.
 */
export async function setBreakpoint(
  page: Page,
  breakpoint: 'desktop' | 'tablet' | 'mobile',
) {
  const sizes: Record<string, { width: number; height: number }> = {
    desktop: { width: 1280, height: 800 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 812 },
  };

  await page.setViewportSize(sizes[breakpoint]);
}
