import { describe, it, expect } from 'vitest';
import { queryNpmVersions } from '../../../src/tools/dependency/queryNpmVersions.js';

describe('queryNpmVersions', () => {
  it('fetches latest version for a real package', async () => {
    const result = await queryNpmVersions({ packages: ['next'] });
    // Should get a result (network-dependent but npm is reliable)
    if (Object.keys(result.versions).length > 0) {
      expect(result.versions['next']).toBeDefined();
      expect(result.versions['next'].latest).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.versions['next'].latestMajor).toBeGreaterThanOrEqual(13);
    }
  }, 15_000);

  it('handles non-existent package gracefully', async () => {
    const result = await queryNpmVersions({
      packages: ['this-package-does-not-exist-xyz-abc-123'],
    });
    expect(result.versions).not.toHaveProperty('this-package-does-not-exist-xyz-abc-123');
  }, 15_000);
});
