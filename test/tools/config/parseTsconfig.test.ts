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

  it('handles trailing commas in tsconfig', async () => {
    const fixtureTrailing = path.resolve('test/fixtures/tsconfig-trailing-commas');
    const result = await parseTsconfig(fixtureTrailing, {});
    expect(result.error).toBeUndefined();
    expect(result.target).toBe('ES2022');
    expect(result.strict).toBe(true);
    expect(result.jsx).toBe('react-jsx');
  });

  it('handles both comments and trailing commas', async () => {
    const fixtureTrailing = path.resolve('test/fixtures/tsconfig-trailing-commas');
    const result = await parseTsconfig(fixtureTrailing, {});
    expect(result.error).toBeUndefined();
    expect(result.paths).toHaveProperty('@/*');
  });

  it('returns error for missing file', async () => {
    const result = await parseTsconfig(FIXTURE, { path: 'nope.json' });
    expect(result.error).toContain('not found');
  });
});
