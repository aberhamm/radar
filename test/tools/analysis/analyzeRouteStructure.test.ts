import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { analyzeRouteStructure } from '../../../src/tools/analysis/analyzeRouteStructure.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('analyzeRouteStructure', () => {
  it('detects pages router and extracts routes', async () => {
    const result = await analyzeRouteStructure(FIXTURE, { repoPath: '.' });
    expect(result.routerType).toBe('pages');
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.catchAllRoutes.length).toBeGreaterThan(0);
    expect(result.apiRoutes.some((r) => r.filePath.includes('editing/render'))).toBe(true);
  });

  it('returns empty routes for empty src/', async () => {
    const result = await analyzeRouteStructure(path.resolve('test/fixtures'), { repoPath: '.' });
    expect(result.routes).toEqual([]);
  });
});
