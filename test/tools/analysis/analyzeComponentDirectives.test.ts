import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { analyzeComponentDirectives } from '../../../src/tools/analysis/analyzeComponentDirectives.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('analyzeComponentDirectives', () => {
  it('finds "use client" in ClientWidget', async () => {
    const result = await analyzeComponentDirectives(FIXTURE, { path: 'src/components' });
    expect(result.total).toBe(2);
    expect(result.clientComponents).toBe(1);
    expect(result.serverComponents).toBe(1);
    expect(result.clientComponentPaths[0]).toContain('ClientWidget');
  });

  it('returns empty for non-existent path', async () => {
    const result = await analyzeComponentDirectives(FIXTURE, { path: 'nope' });
    expect(result.total).toBe(0);
  });
});
