import { readdir, stat as fsStat } from 'node:fs/promises';
import path from 'node:path';
import type { FindFilesInput, FindFilesOutput } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

export async function findFiles(
  repoRoot: string,
  input: FindFilesInput,
): Promise<FindFilesOutput> {
  const searchPath = input.path ? path.resolve(repoRoot, input.path) : repoRoot;
  const matches: string[] = [];
  await walk(searchPath, repoRoot, input.pattern, input.type, matches);
  return { matches };
}

async function walk(
  dir: string,
  repoRoot: string,
  pattern: string,
  typeFilter: 'file' | 'directory' | undefined,
  results: string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (EXCLUDED_DIRS.has(name)) continue;

    const fullPath = path.join(dir, name);
    let stats;
    try {
      stats = await fsStat(fullPath);
    } catch {
      continue;
    }

    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

    if (stats.isDirectory()) {
      if (matchPattern(name, pattern) && typeFilter !== 'file') {
        results.push(relativePath);
      }
      await walk(fullPath, repoRoot, pattern, typeFilter, results);
    } else if (stats.isFile()) {
      if (matchPattern(name, pattern) && typeFilter !== 'directory') {
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
