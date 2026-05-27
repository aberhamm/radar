import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for integration tests that require a running Next.js dev server.
 * Run with: pnpm test:integration
 *
 * Prerequisites: either start the dashboard dev server first (`pnpm dev`)
 * or set TEST_BASE_URL to point to an already-running server.
 */
export default defineConfig({
  resolve: {
    alias: {
      'next/server': path.resolve(__dirname, 'dashboard/node_modules/next/server.js'),
      '@': path.resolve(__dirname, 'dashboard/src'),
    },
  },
  test: {
    globals: true,
    include: ['test/dashboard/api-routes.test.ts'],
    testTimeout: 30000,
  },
});
