import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { listDirectory } from '../../../src/tools/repo/listDirectory.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('listDirectory', () => {
  it('lists fixture root files and dirs', async () => {
    const result = await listDirectory(FIXTURE, { path: '.' });
    const names = result.entries.map((e) => e.name);
    expect(names).toContain('package.json');
    expect(names).toContain('next.config.js');
    expect(names).toContain('src');
    expect(names).not.toContain('node_modules');
  });

  it('returns error for non-existent path', async () => {
    const result = await listDirectory(FIXTURE, { path: 'does-not-exist' });
    expect(result.entries).toEqual([]);
    expect(result.error).toContain('does not exist');
  });

  it('returns error when path is a file, not a directory', async () => {
    const result = await listDirectory(FIXTURE, { path: 'package.json' });
    expect(result.entries).toEqual([]);
    expect(result.error).toContain('not a directory');
  });
});
