import { describe, it, expect, afterAll } from 'vitest';
import { resolveAndRead, isResolveError } from '../../../src/tools/utils/resolveAndRead.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('resolveAndRead', () => {
  // Happy path
  it('reads a known file and returns content + lineCount', async () => {
    const result = await resolveAndRead(FIXTURE, 'package.json');
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      expect(result.content).toContain('"name"');
      expect(result.lineCount).toBeGreaterThan(0);
      expect(result.absolutePath).toContain('package.json');
    }
  });

  // Path traversal
  it('rejects path traversal attempts', async () => {
    const result = await resolveAndRead(FIXTURE, '../../etc/passwd');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Path traversal rejected');
    }
  });

  // Excluded paths
  it('rejects node_modules paths', async () => {
    const result = await resolveAndRead(FIXTURE, 'node_modules/foo/index.js');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Excluded path');
    }
  });

  it('rejects .git paths', async () => {
    const result = await resolveAndRead(FIXTURE, '.git/config');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Excluded path');
    }
  });

  // Not a file
  it('returns error for directory path', async () => {
    const result = await resolveAndRead(FIXTURE, 'src');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Not a file');
    }
  });

  // ENOENT with suggestions
  it('suggests similar files on ENOENT', async () => {
    const result = await resolveAndRead(FIXTURE, 'pakage.json');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('File not found');
      expect(result.error).toContain('Did you mean');
      expect(result.error).toContain('package.json');
    }
  });

  // ENOENT without suggestions (non-existent directory)
  it('returns plain not-found when directory does not exist', async () => {
    const result = await resolveAndRead(FIXTURE, 'nonexistent-dir/foo.ts');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('File not found');
      expect(result.error).not.toContain('Did you mean');
    }
  });

  // Binary file detection
  const tmpBinaryDir = path.join(tmpdir(), `resolve-test-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpBinaryDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects binary files by extension', async () => {
    mkdirSync(tmpBinaryDir, { recursive: true });
    writeFileSync(path.join(tmpBinaryDir, 'image.png'), 'not really a png');
    const result = await resolveAndRead(tmpBinaryDir, 'image.png');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Binary file detected');
    }
  });

  it('detects binary files by content (null bytes)', async () => {
    mkdirSync(tmpBinaryDir, { recursive: true });
    writeFileSync(path.join(tmpBinaryDir, 'data.bin'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x0D, 0x0A]));
    // .bin is not in BINARY_EXTENSIONS, so it falls through to content check
    const result = await resolveAndRead(tmpBinaryDir, 'data.bin');
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.error).toContain('Binary file detected');
    }
  });

  // maxLines truncation
  it('truncates content at maxLines', async () => {
    const result = await resolveAndRead(FIXTURE, 'package.json', 2);
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      const lines = result.content.split('\n');
      // First 2 lines + truncation notice
      expect(lines.length).toBeLessThanOrEqual(4); // 2 content + truncation line + possible trailing
      expect(result.content).toContain('truncated');
      expect(result.lineCount).toBeGreaterThan(2);
    }
  });

  // lineCount accuracy
  it('returns accurate lineCount for full read', async () => {
    const result = await resolveAndRead(FIXTURE, 'tsconfig.json');
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      const actualLines = result.content.split('\n').length;
      expect(result.lineCount).toBe(actualLines);
    }
  });
});
