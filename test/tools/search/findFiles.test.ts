import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { findFiles } from '../../../src/tools/search/findFiles.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('findFiles', () => {
  it('finds *.tsx files', async () => {
    const result = await findFiles(FIXTURE, { pattern: '*.tsx' });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((m) => m.endsWith('.tsx'))).toBe(true);
  });

  it('returns empty for no matches', async () => {
    const result = await findFiles(FIXTURE, { pattern: '*.xyz' });
    expect(result.matches).toEqual([]);
  });
});
