import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { analyzeMiddleware } from '../../../src/tools/analysis/analyzeMiddleware.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('analyzeMiddleware', () => {
  it('detects middleware.ts in src/ and extracts matchers', async () => {
    const result = await analyzeMiddleware(FIXTURE, { repoPath: '.' });
    expect(result.exists).toBe(true);
    expect(result.path).toContain('middleware.ts');
    expect(result.matchers).toContain('/api/:path*');
    expect(result.imports).toContain('next/server');
  });

  it('returns exists:false for path without middleware', async () => {
    const result = await analyzeMiddleware(FIXTURE, { repoPath: 'src/components' });
    expect(result.exists).toBe(false);
    expect(result.detectedPurposes).toEqual([]);
  });
});
