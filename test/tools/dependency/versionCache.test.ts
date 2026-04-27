import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeCache, readCache, readStaleCache } from '../../../src/tools/dependency/versionCache.js';

const CACHE_DIR = path.join(os.homedir(), '.repo-audit-delivery-agent');
const CACHE_FILE = path.join(CACHE_DIR, 'version-cache.json');

describe('versionCache', () => {
  // Save and restore original cache if it exists
  let originalCache: string | null = null;

  afterEach(() => {
    if (originalCache !== null) {
      fs.writeFileSync(CACHE_FILE, originalCache, 'utf-8');
    }
  });

  it('writes and reads cache', async () => {
    // Save original
    if (fs.existsSync(CACHE_FILE)) {
      originalCache = fs.readFileSync(CACHE_FILE, 'utf-8');
    }

    const versions = {
      next: { package: 'next', latest: '15.1.0', latestMajor: 15, fetchedAt: new Date().toISOString() },
    };
    await writeCache(versions);
    const cached = await readCache();
    expect(cached).not.toBeNull();
    expect(cached!.versions['next'].latest).toBe('15.1.0');
  });

  it('returns null for expired cache', async () => {
    if (fs.existsSync(CACHE_FILE)) {
      originalCache = fs.readFileSync(CACHE_FILE, 'utf-8');
    }

    // Write cache with old timestamp
    const entry = {
      versions: { next: { package: 'next', latest: '15.0.0', latestMajor: 15, fetchedAt: '2020-01-01T00:00:00Z' } },
      timestamp: '2020-01-01T00:00:00Z',
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry), 'utf-8');

    expect(await readCache()).toBeNull();
    // But stale cache should still work
    expect(await readStaleCache()).not.toBeNull();
  });
});
