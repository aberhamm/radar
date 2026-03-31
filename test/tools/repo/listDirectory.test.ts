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

  it('returns empty for non-existent path', async () => {
    const result = await listDirectory(FIXTURE, { path: 'does-not-exist' });
    expect(result.entries).toEqual([]);
  });
});
