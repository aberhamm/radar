import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../../src/tools/dependency/compareVersions.js';

describe('compareVersions', () => {
  it('detects major version behind', () => {
    const result = compareVersions({
      installed: [{ name: 'next', version: '14.1.0', isDev: false }],
      latest: { next: { package: 'next', latest: '15.1.0', latestMajor: 15, fetchedAt: '' } },
    });
    expect(result.results[0].delta).toBe('major-behind-1');
    expect(result.results[0].severity).toBe('medium');
  });

  it('handles invalid semver gracefully', () => {
    const result = compareVersions({
      installed: [{ name: 'foo', version: 'latest', isDev: false }],
      latest: { foo: { package: 'foo', latest: '1.0.0', latestMajor: 1, fetchedAt: '' } },
    });
    expect(result.results).toHaveLength(0);
  });
});
