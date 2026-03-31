import fs from 'node:fs';
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

/**
 * Read the version cache. Returns null if cache doesn't exist or is expired.
 */
export function readCache(): CacheEntry | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const age = Date.now() - new Date(entry.timestamp).getTime();
    if (age > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read the cache even if expired (fallback on network failure).
 */
export function readStaleCache(): CacheEntry | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write versions to cache.
 */
export function writeCache(versions: Record<string, ResolvedVersion>): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const entry: CacheEntry = {
      versions,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Silently fail — cache is optional
  }
}

/**
 * Get the age of the cache as a human-readable string.
 */
export function cacheAge(): string | undefined {
  try {
    if (!fs.existsSync(CACHE_FILE)) return undefined;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const ms = Date.now() - new Date(entry.timestamp).getTime();
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return undefined;
  }
}
