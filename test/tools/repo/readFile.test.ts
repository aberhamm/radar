import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFile } from '../../../src/tools/repo/readFile.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('readFile', () => {
  it('reads package.json content', async () => {
    const result = await readFile(FIXTURE, { path: 'package.json' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('"sitecore-minimal"');
    expect(result.language).toBe('json');
    expect(result.lineCount).toBeGreaterThan(0);
  });

  it('returns error for missing file', async () => {
    const result = await readFile(FIXTURE, { path: 'nope.txt' });
    expect(result.error).toContain('not found');
    expect(result.content).toBe('');
  });
});
