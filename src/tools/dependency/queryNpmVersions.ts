import type { ResolvedVersion } from '../../types/state.js';
import type { QueryNpmVersionsInput, QueryNpmVersionsOutput } from '../../types/tools.js';
import { readCache, readStaleCache, writeCache, cacheAge } from './versionCache.js';

/**
 * Tracked packages that the agent resolves versions for before the investigation loop.
 */
export const TRACKED_PACKAGES = [
  // Core framework
  'next',
  'react',
  'react-dom',
  'typescript',

  // Sitecore
  '@sitecore-jss/sitecore-jss-nextjs',
  '@sitecore-jss/sitecore-jss-react',
  '@sitecore-jss/sitecore-jss',
  '@sitecore/components',
  '@sitecore-cloudsdk/events',

  // Optimizely
  '@remkoj/optimizely-cms-nextjs',
  '@remkoj/optimizely-cms-react',
  '@remkoj/optimizely-cms-api',
  '@remkoj/optimizely-graph-client',

  // Common ecosystem
  'eslint',
  'tailwindcss',
  'graphql',
  'graphql-request',
];

/**
 * Fetch a single package's latest version from the npm registry.
 */
async function fetchLatestVersion(packageName: string): Promise<ResolvedVersion | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    if (!data.version) return null;

    const major = parseInt(data.version.split('.')[0], 10);
    return {
      package: packageName,
      latest: data.version,
      latestMajor: isNaN(major) ? 0 : major,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Query npm registry for latest versions of the given packages.
 * Uses a 24h cache; falls back to stale cache on network failure.
 */
export async function queryNpmVersions(
  input: QueryNpmVersionsInput,
): Promise<QueryNpmVersionsOutput> {
  const { packages } = input;

  // Check cache first
  const cached = readCache();
  if (cached) {
    // Check if all requested packages are in cache
    const allCached = packages.every((p) => p in cached.versions);
    if (allCached) {
      // Filter to only requested packages
      const filtered: Record<string, ResolvedVersion> = {};
      for (const p of packages) {
        filtered[p] = cached.versions[p];
      }
      return { versions: filtered, fromCache: true, cacheAge: cacheAge() };
    }
  }

  // Fetch from npm registry
  const results: Record<string, ResolvedVersion> = {};
  const fetches = packages.map(async (pkg) => {
    const resolved = await fetchLatestVersion(pkg);
    if (resolved) {
      results[pkg] = resolved;
    }
  });

  await Promise.all(fetches);

  // If we got results, update cache
  if (Object.keys(results).length > 0) {
    // Merge with existing cache to preserve other packages
    const existing = readStaleCache();
    const merged = { ...(existing?.versions ?? {}), ...results };
    writeCache(merged);
    return { versions: results, fromCache: false };
  }

  // Fall back to stale cache on total network failure
  const stale = readStaleCache();
  if (stale) {
    const filtered: Record<string, ResolvedVersion> = {};
    for (const p of packages) {
      if (p in stale.versions) {
        filtered[p] = stale.versions[p];
      }
    }
    if (Object.keys(filtered).length > 0) {
      return { versions: filtered, fromCache: true, cacheAge: cacheAge() };
    }
  }

  // Nothing available
  return { versions: {}, fromCache: false };
}
