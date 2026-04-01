import { describe, it, expect } from 'vitest';
import { stripRepoPrefix } from '../../../src/tools/utils/stripRepoPrefix.js';

describe('stripRepoPrefix', () => {
  it('strips repo root from absolute path', () => {
    const result = stripRepoPrefix('/home/user/repos/my-app/src/index.ts', '/home/user/repos/my-app');
    // path.normalize uses OS separators — accept either
    expect(result.replace(/\\/g, '/')).toBe('src/index.ts');
  });

  it('returns unchanged if path does not start with repo root', () => {
    expect(stripRepoPrefix('/other/path/file.ts', '/home/user/repos/my-app'))
      .toBe('/other/path/file.ts');
  });

  it('handles Windows-style paths', () => {
    const result = stripRepoPrefix(
      'C:\\Users\\dev\\repos\\my-app\\src\\index.ts',
      'C:\\Users\\dev\\repos\\my-app',
    );
    expect(result).toBe('src\\index.ts');
  });

  it('returns "." when path equals repo root', () => {
    expect(stripRepoPrefix('/home/user/repos/my-app', '/home/user/repos/my-app'))
      .toBe('.');
  });
});
