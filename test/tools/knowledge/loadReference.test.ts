import { describe, it, expect } from 'vitest';
import { loadReference, listReferences } from '../../../src/tools/knowledge/loadReference.js';

describe('loadReference', () => {
  it('loads a valid reference file by key', async () => {
    const result = await loadReference({ key: 'nextjs/caching-strategies' });
    expect(result.key).toBe('nextjs/caching-strategies');
    expect(result.content).toContain('cach');
    expect(result.charCount).toBeGreaterThan(100);
  });

  it('throws for nonexistent key', async () => {
    await expect(loadReference({ key: 'nonexistent/file' })).rejects.toThrow();
  });

  it('rejects path traversal', async () => {
    await expect(loadReference({ key: '../rules/core' })).rejects.toThrow('path traversal');
  });
});

describe('listReferences', () => {
  it('returns all reference files grouped by platform', async () => {
    const result = await listReferences();
    expect(result.total).toBeGreaterThanOrEqual(16);
    expect(result.references.some((r) => r.platform === 'nextjs')).toBe(true);
    expect(result.references.some((r) => r.platform === 'sitecore')).toBe(true);
    expect(result.references.some((r) => r.platform === 'optimizely')).toBe(true);
    expect(result.references.some((r) => r.platform === 'consulting')).toBe(true);
    expect(result.references.every((r) => r.key.includes('/'))).toBe(true);
  });
});
