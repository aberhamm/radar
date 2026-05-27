import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Allow tests to import dashboard route handlers that depend on next/server.
      // next is only installed inside dashboard/node_modules.
      'next/server': path.resolve(__dirname, 'dashboard/node_modules/next/server.js'),
      // Allow tests to import dashboard src modules that use @/ paths.
      '@': path.resolve(__dirname, 'dashboard/src'),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/dashboard/api-routes.test.ts'],
    testTimeout: 10000,
  },
});
