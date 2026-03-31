import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { analyzeEnvUsage } from '../../../src/tools/analysis/analyzeEnvUsage.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('analyzeEnvUsage', () => {
  it('finds process.env references', async () => {
    const result = await analyzeEnvUsage(FIXTURE, { repoPath: '.' });
    expect(result.usages.length).toBeGreaterThan(0);
    const vars = result.usages.map((u) => u.variable);
    expect(vars).toContain('SITECORE_API_KEY');
  });

  it('returns empty for no env usage', async () => {
    const result = await analyzeEnvUsage(FIXTURE, { repoPath: 'src/components' });
    expect(result.usages).toEqual([]);
  });
});
