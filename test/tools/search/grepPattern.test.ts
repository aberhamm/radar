import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { grepPattern } from '../../../src/tools/search/grepPattern.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('grepPattern', () => {
  it('finds "use client" in components', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'use client',
      path: 'src/components',
    });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].filePath).toContain('ClientWidget');
  });

  it('returns empty for no matches', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'ZZZZZ_NO_MATCH_ZZZZZ',
    });
    expect(result.matches).toEqual([]);
  });
});
