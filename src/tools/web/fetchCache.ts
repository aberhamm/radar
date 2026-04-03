/**
 * LRU cache with TTL for fetch_url results.
 *
 * Prevents duplicate fetches when the agent revisits the same documentation URL.
 * Cache is per-process (lives for a single agent run).
 */

import type { FetchUrlOutput } from '../../types/tools.js';

interface CacheEntry {
  url: string;
  content: FetchUrlOutput;
  size: number;
  fetchedAt: number;
}

export class FetchLruCache {
  private map = new Map<string, CacheEntry>();
  private totalSize = 0;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 50 * 1024 * 1024, ttlMs = 15 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(url: string): FetchUrlOutput | null {
    const entry = this.map.get(url);
    if (!entry) return null;

    // TTL check
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.totalSize -= entry.size;
      this.map.delete(url);
      return null;
    }

    // Move to end (most recently used) by re-inserting
    this.map.delete(url);
    this.map.set(url, entry);

    return entry.content;
  }

  set(url: string, result: FetchUrlOutput): void {
    // Remove existing entry if present
    const existing = this.map.get(url);
    if (existing) {
      this.totalSize -= existing.size;
      this.map.delete(url);
    }

    const size = estimateSize(result);

    // Evict oldest entries until under limit
    while (this.totalSize + size > this.maxSize && this.map.size > 0) {
      const oldest = this.map.keys().next().value!;
      const entry = this.map.get(oldest)!;
      this.totalSize -= entry.size;
      this.map.delete(oldest);
    }

    this.map.set(url, { url, content: result, size, fetchedAt: Date.now() });
    this.totalSize += size;
  }

  clear(): void {
    this.map.clear();
    this.totalSize = 0;
  }

  get stats(): { entries: number; totalSize: number } {
    return { entries: this.map.size, totalSize: this.totalSize };
  }
}

function estimateSize(result: FetchUrlOutput): number {
  // Approximate UTF-16 byte size
  return (result.content.length + result.title.length + result.url.length) * 2;
}

/** Singleton cache instance — shared across all fetch_url calls in a run. */
export const fetchCache = new FetchLruCache();
