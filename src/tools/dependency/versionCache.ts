import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ResolvedVersion } from '../../types/state.js';

const CACHE_DIR = path.join(os.homedir(), '.repo-audit-delivery-agent');
const CACHE_FILE = path.join(CACHE_DIR, 'version-cache.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  versions: Record<string, ResolvedVersion>;
  timestamp: string;
}

async function cacheExists(): Promise<boolean> {
  try {
    await access(CACHE_FILE);
    return true;
  } catch {
    return false;
  }
}

async function readCacheFile(): Promise<CacheEntry | null> {
  try {
    if (!(await cacheExists())) return null;
    const raw = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

/**
 * Read the version cache. Returns null if cache doesn't exist or is expired.
 */
export async function readCache(): Promise<CacheEntry | null> {
  const entry = await readCacheFile();
  if (!entry) return null;
  const age = Date.now() - new Date(entry.timestamp).getTime();
  if (age > TTL_MS) return null;
  return entry;
}

/**
 * Read the cache even if expired (fallback on network failure).
 */
export async function readStaleCache(): Promise<CacheEntry | null> {
  return readCacheFile();
}

/**
 * Write versions to cache.
 */
export async function writeCache(versions: Record<string, ResolvedVersion>): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entry: CacheEntry = {
      versions,
      timestamp: new Date().toISOString(),
    };
    await writeFile(CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Silently fail — cache is optional
  }
}

/**
 * Get the age of the cache as a human-readable string.
 */
export async function cacheAge(): Promise<string | undefined> {
  try {
    const entry = await readCacheFile();
    if (!entry) return undefined;
    const ms = Date.now() - new Date(entry.timestamp).getTime();
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return undefined;
  }
}
