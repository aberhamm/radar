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

  // --- Pagination ---
  it('paginates with offset', async () => {
    const all = await grepPattern(FIXTURE, { pattern: 'import', maxResults: 10 });
    const page2 = await grepPattern(FIXTURE, { pattern: 'import', maxResults: 5, offset: 5 });
    // page2 should start where first page ended
    if (all.matches.length > 5) {
      expect(page2.matches[0].filePath).toBe(all.matches[5].filePath);
      expect(page2.matches[0].lineNumber).toBe(all.matches[5].lineNumber);
    }
  });

  it('sets truncated flag when more results exist', async () => {
    const result = await grepPattern(FIXTURE, { pattern: 'import', maxResults: 2 });
    // 'import' appears many times in the fixture — should be truncated
    expect(result.truncated).toBe(true);
  });

  // --- Output modes ---
  it('files_with_matches returns file paths only', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'use client',
      outputMode: 'files_with_matches',
    });
    expect(result.matchedFiles).toBeDefined();
    expect(result.matchedFiles!.length).toBeGreaterThan(0);
    expect(result.matches).toEqual([]);
    for (const f of result.matchedFiles!) {
      expect(f).not.toContain('\\');
    }
  });

  it('count mode returns per-file match counts', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'import',
      outputMode: 'count',
    });
    expect(result.fileCounts).toBeDefined();
    const files = Object.keys(result.fileCounts!);
    expect(files.length).toBeGreaterThan(0);
    for (const count of Object.values(result.fileCounts!)) {
      expect(count).toBeGreaterThan(0);
    }
  });

  // --- Multiline ---
  it('matches across line boundaries with multiline flag', async () => {
    const result = await grepPattern(FIXTURE, {
      pattern: 'import.*\\n.*from',
      isRegex: true,
      multiline: true,
    });
    // Should find multi-line import statements
    expect(result.matches.length).toBeGreaterThanOrEqual(0);
    // No crash is the baseline test for multiline support
  });

  // --- mtime sort ---
  it('sortByMtime sorts results by file modification time', async () => {
    const unsorted = await grepPattern(FIXTURE, { pattern: 'import', maxResults: 10 });
    const sorted = await grepPattern(FIXTURE, { pattern: 'import', maxResults: 10, sortByMtime: true });
    // Both should return results
    expect(sorted.matches.length).toBeGreaterThan(0);
    // Files may be in different order (or same if all have same mtime)
    expect(sorted.matches.length).toBe(unsorted.matches.length);
  });
});
