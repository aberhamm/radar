import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import type { FindFilesInput, FindFilesOutput } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

const DEFAULT_MAX_RESULTS = 200;

export async function findFiles(
  repoRoot: string,
  input: FindFilesInput,
): Promise<FindFilesOutput> {
  const searchPath = input.path ? path.resolve(repoRoot, input.path) : repoRoot;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

  // Check that search path exists
  try {
    await access(searchPath);
  } catch {
    return {
      matches: [],
      error: `Search path "${input.path ?? '.'}" does not exist. Use "." to search from the repo root.`,
    };
  }

  const matches: string[] = [];
  await walk(searchPath, repoRoot, input.pattern, input.type, matches, maxResults);
  const truncated = matches.length >= maxResults;
  if (truncated) matches.length = maxResults;
  return { matches, truncated };
}

async function walk(
  dir: string,
  repoRoot: string,
  pattern: string,
  typeFilter: 'file' | 'directory' | undefined,
  results: string[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

    if (results.length >= maxResults) return;

    if (entry.isDirectory()) {
      if (matchPattern(entry.name, pattern) && typeFilter !== 'file') {
        results.push(relativePath);
      }
      await walk(fullPath, repoRoot, pattern, typeFilter, results, maxResults);
    } else if (entry.isFile()) {
      if (matchPattern(entry.name, pattern) && typeFilter !== 'directory') {
        results.push(relativePath);
      }
    }
  }
}

function matchPattern(filename: string, pattern: string): boolean {
  // *.ext glob
  if (pattern.startsWith('*.')) {
    return filename.endsWith(pattern.slice(1));
  }
  // Exact match or substring
  return filename.includes(pattern);
}
