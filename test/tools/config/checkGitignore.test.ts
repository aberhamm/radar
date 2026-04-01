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

  it('matches wildcard patterns in .gitignore', async () => {
    // The project root .gitignore has *.log and *.tsbuildinfo
    const rootResult = await checkGitignore(path.resolve('.'), { patterns: ['debug.log', 'tsconfig.tsbuildinfo'] });
    if (rootResult.exists) {
      const logResult = rootResult.results.find((r) => r.pattern === 'debug.log');
      expect(logResult?.ignored).toBe(true);
    }
  });

  it('returns exists: false when no .gitignore', async () => {
    const result = await checkGitignore(path.resolve('test/fixtures'), { patterns: ['.env'] });
    expect(result.exists).toBe(false);
  });
});
