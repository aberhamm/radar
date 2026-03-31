import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFilesBatch } from '../../../src/tools/repo/readFilesBatch.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('readFilesBatch', () => {
  it('reads multiple files at once', async () => {
    const result = await readFilesBatch(FIXTURE, {
      paths: ['package.json', 'tsconfig.json', 'next.config.js'],
    });
    expect(result.files).toHaveLength(3);
    expect(result.files[0].content).toContain('sitecore-minimal');
    expect(result.files[1].content).toContain('compilerOptions');
    expect(result.files[2].content).toContain('withSitecoreConfig');
  });

  it('returns partial results for mix of valid and missing', async () => {
    const result = await readFilesBatch(FIXTURE, {
      paths: ['package.json', 'missing.txt'],
    });
    expect(result.files).toHaveLength(2);
    expect(result.files[0].error).toBeUndefined();
    expect(result.files[1].error).toContain('not found');
  });
});
