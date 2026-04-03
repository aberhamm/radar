import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { grepPattern } from '../../../src/tools/search/grepPattern.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('grepPattern', () => {
  // Basic string matching
  it('finds literal text matches with line numbers', async () => {
    const result = await grepPattern(FIXTURE, { pattern: 'use client' });
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(m.line).toContain('use client');
      expect(m.lineNumber).toBeGreaterThan(0);
      expect(m.filePath).toBeTruthy();
    }
  });

  it('returns empty array for no matches', async () => {
    const result = await grepPattern(FIXTURE, { pattern: 'xyzzy_nonexistent_pattern_12345' });
    expect(result.matches).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  // Regex
  it('finds regex pattern matches when isRegex=true', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'use\\s+(client|server)',
      isRegex: true,
    });
    expect(result.matches.length).toBeGreaterThan(0);
  });

  // File glob
  it('filters by fileGlob *.ts', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'import',
      fileGlob: '*.ts',
    });
    for (const m of result.matches) {
      expect(m.filePath).toMatch(/\.ts$/);
    }
  });

  it('supports comma-separated globs', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'import',
      fileGlob: '*.ts,*.tsx',
    });
    for (const m of result.matches) {
      expect(m.filePath).toMatch(/\.tsx?$/);
    }
  });

  // Max results
  it('stops at maxResults limit', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'import',
      maxResults: 3,
    });
    expect(result.matches.length).toBeLessThanOrEqual(3);
  });

  // Path handling
  it('searches subdirectory when path is specified', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'use client',
      path: 'src/components',
    });
    for (const m of result.matches) {
      expect(m.filePath).toMatch(/^src\/components\//);
    }
  });

  it('returns error for non-existent search path', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'test',
      path: 'nonexistent-dir',
    });
    expect(result.matches).toEqual([]);
    expect(result.error).toContain('does not exist');
  });

  it('returns relative paths with forward slashes', async () => {
    const result = await grepPattern(FIXTURE, { pattern: 'use client' });
    for (const m of result.matches) {
      expect(m.filePath).not.toContain('\\');
      expect(m.filePath).not.toMatch(/^[A-Z]:/);
    }
  });

  // Context lines
  it('includes context lines', async () => {
    const result = await grepPattern(FIXTURE, { pattern: 'use client' });
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(m.context.length).toBeGreaterThanOrEqual(1);
    }
  });
});
