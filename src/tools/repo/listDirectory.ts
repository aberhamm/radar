import { readdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import type { ListDirectoryInput, ListDirectoryOutput, FileEntry } from '../../types/tools.js';

const EXCLUDED = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

const DEFAULT_MAX_ENTRIES = 200;

export async function listDirectory(
  repoRoot: string,
  input: ListDirectoryInput,
): Promise<ListDirectoryOutput> {
  const targetPath = path.resolve(repoRoot, input.path);
  const depth = input.depth ?? 1;
  const includeHidden = input.includeHidden ?? false;
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;

  // Check that the target directory exists before walking
  try {
    await access(targetPath);
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      return {
        entries: [],
        error: `Path "${input.path}" exists but is not a directory (it's a file). Use read_file instead.`,
        errorCode: 'PATH_NOT_DIRECTORY',
      };
    }
  } catch {
    return {
      entries: [],
      error: `Directory "${input.path}" does not exist. Check the path — use "." to list the repo root, or try list_directory with "." first to see what's available.`,
      errorCode: 'FILE_NOT_FOUND',
    };
  }

  const entries: FileEntry[] = [];
  await walk(targetPath, repoRoot, depth, includeHidden, entries, maxEntries);
  return { entries };
}

async function walk(
  dir: string,
  repoRoot: string,
  remainingDepth: number,
  includeHidden: boolean,
  results: FileEntry[],
  maxEntries: number,
): Promise<void> {
  if (remainingDepth <= 0 || results.length >= maxEntries) return;

  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return;
  }

  for (const name of items) {
    if (EXCLUDED.has(name)) continue;
    if (!includeHidden && name.startsWith('.')) continue;

    const fullPath = path.join(dir, name);
    try {
      const stats = await stat(fullPath);
      const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      const entry: FileEntry = {
        name,
        type: stats.isDirectory() ? 'directory' : 'file',
        path: relativePath,
        ...(stats.isFile() ? { size: stats.size } : {}),
      };
      results.push(entry);
      if (results.length >= maxEntries) return;

      if (stats.isDirectory() && remainingDepth > 1) {
        await walk(fullPath, repoRoot, remainingDepth - 1, includeHidden, results, maxEntries);
      }
    } catch {
      // Skip inaccessible entries
    }
  }
}
