import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { analyzeRouteStructure } from '../../../src/tools/analysis/analyzeRouteStructure.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('analyzeRouteStructure', () => {
  it('detects hybrid router and extracts routes from both app and pages dirs', async () => {
    const result = await analyzeRouteStructure(FIXTURE, { repoPath: '.' });
    expect(result.routerType).toBe('hybrid');
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.catchAllRoutes.length).toBeGreaterThan(0);
    // Pages Router API routes
    expect(result.apiRoutes.some((r) => r.filePath.includes('editing/render'))).toBe(true);
    // App Router routes
    expect(result.routes.some((r) => r.filePath.includes('app/'))).toBe(true);
    expect(result.apiRoutes.some((r) => r.filePath.includes('app/api/'))).toBe(true);
    // App Router catch-all
    const appCatchAll = result.catchAllRoutes.find((r) => r.filePath.includes('app/'));
    expect(appCatchAll).toBeDefined();
    expect(appCatchAll!.params).toContain('path');
  });

  it('returns empty routes for empty src/', async () => {
    const result = await analyzeRouteStructure(path.resolve('test/fixtures'), { repoPath: '.' });
    expect(result.routes).toEqual([]);
  });
});
