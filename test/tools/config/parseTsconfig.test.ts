import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseTsconfig } from '../../../src/tools/config/parseTsconfig.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('parseTsconfig', () => {
  it('extracts compilerOptions and paths', async () => {
    const result = await parseTsconfig(FIXTURE, {});
    expect(result.error).toBeUndefined();
    expect(result.target).toBe('ES2017');
    expect(result.strict).toBe(true);
    expect(result.paths).toHaveProperty('@/*');
    expect(result.jsx).toBe('preserve');
  });

  it('returns error for missing file', async () => {
    const result = await parseTsconfig(FIXTURE, { path: 'nope.json' });
    expect(result.error).toContain('not found');
  });
});
