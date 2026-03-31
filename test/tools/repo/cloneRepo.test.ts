import { describe, it, expect } from 'vitest';
import { cloneRepo } from '../../../src/tools/repo/cloneRepo.js';

describe('cloneRepo', () => {
  it('rejects invalid URLs', async () => {
    await expect(cloneRepo({ url: 'not-a-url' })).rejects.toThrow('Invalid repository URL');
  });

  // Network-dependent test — skip in CI, run manually
  it.skip('clones a public repo', async () => {
    const result = await cloneRepo({
      url: 'https://github.com/vercel/next.js',
      branch: 'canary',
    });
    expect(result.localPath).toBeTruthy();
    expect(result.defaultBranch).toBe('canary');
    expect(result.lastCommit.hash).toBeTruthy();
  });
});
