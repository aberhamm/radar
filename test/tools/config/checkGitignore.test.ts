import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { checkGitignore } from '../../../src/tools/config/checkGitignore.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('checkGitignore', () => {
  it('confirms .env is ignored', async () => {
    const result = await checkGitignore(FIXTURE, { patterns: ['.env', '.env.local', 'node_modules'] });
    expect(result.exists).toBe(true);
    const envResult = result.results.find((r) => r.pattern === '.env');
    expect(envResult?.ignored).toBe(true);
  });

  it('returns exists: false when no .gitignore', async () => {
    const result = await checkGitignore(path.resolve('test/fixtures'), { patterns: ['.env'] });
    expect(result.exists).toBe(false);
  });
});
