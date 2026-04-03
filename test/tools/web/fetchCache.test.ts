import { describe, it, expect, beforeEach } from 'vitest';
import { FetchLruCache } from '../../../src/tools/web/fetchCache.js';
import type { FetchUrlOutput } from '../../../src/types/tools.js';

function makeResult(url: string, contentLength = 100): FetchUrlOutput {
  return {
    url,
    title: `Title for ${url}`,
    content: 'x'.repeat(contentLength),
    truncated: false,
  };
}

describe('FetchLruCache', () => {
  let cache: FetchLruCache;

  beforeEach(() => {
    cache = new FetchLruCache(1024, 60_000); // 1KB max, 60s TTL
  });

  it('returns null on cache miss', () => {
    expect(cache.get('https://example.com')).toBeNull();
  });

  it('returns cached content on cache hit', () => {
    const result = makeResult('https://example.com');
    cache.set('https://example.com', result);
    const cached = cache.get('https://example.com');
    expect(cached).toEqual(result);
  });

  it('returns null after TTL expires', () => {
    // Use a cache with very short TTL
    const shortCache = new FetchLruCache(1024, 1); // 1ms TTL
    const result = makeResult('https://example.com');
    shortCache.set('https://example.com', result);

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    expect(shortCache.get('https://example.com')).toBeNull();
  });

  it('evicts oldest entries when over maxSize', () => {
    // Each entry is roughly (url + title + content) * 2 bytes
    // With content length 200, each entry ~ 450+ bytes
    const small = new FetchLruCache(500, 60_000);
    small.set('https://a.com', makeResult('https://a.com', 200));
    small.set('https://b.com', makeResult('https://b.com', 200));

    // b should be present, a should be evicted
    expect(small.get('https://b.com')).not.toBeNull();
    expect(small.get('https://a.com')).toBeNull();
  });

  it('updates existing entry without double-counting size', () => {
    cache.set('https://a.com', makeResult('https://a.com', 50));
    const sizeBefore = cache.stats.totalSize;
    cache.set('https://a.com', makeResult('https://a.com', 50));
    expect(cache.stats.totalSize).toBe(sizeBefore);
    expect(cache.stats.entries).toBe(1);
  });

  it('clear removes all entries', () => {
    cache.set('https://a.com', makeResult('https://a.com'));
    cache.set('https://b.com', makeResult('https://b.com'));
    cache.clear();
    expect(cache.stats.entries).toBe(0);
    expect(cache.stats.totalSize).toBe(0);
  });

  it('tracks stats correctly', () => {
    expect(cache.stats.entries).toBe(0);
    cache.set('https://a.com', makeResult('https://a.com'));
    expect(cache.stats.entries).toBe(1);
    expect(cache.stats.totalSize).toBeGreaterThan(0);
  });
});
