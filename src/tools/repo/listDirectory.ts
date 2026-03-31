import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ListDirectoryInput, ListDirectoryOutput, FileEntry } from '../../types/tools.js';

const EXCLUDED = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

export async function listDirectory(
  repoRoot: string,
  input: ListDirectoryInput,
): Promise<ListDirectoryOutput> {
  const targetPath = path.resolve(repoRoot, input.path);
  const depth = input.depth ?? 1;
  const includeHidden = input.includeHidden ?? false;

  const entries: FileEntry[] = [];
  await walk(targetPath, repoRoot, depth, includeHidden, entries);
  return { entries };
}

async function walk(
  dir: string,
  repoRoot: string,
  remainingDepth: number,
  includeHidden: boolean,
  results: FileEntry[],
): Promise<void> {
  if (remainingDepth <= 0) return;

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

      if (stats.isDirectory() && remainingDepth > 1) {
        await walk(fullPath, repoRoot, remainingDepth - 1, includeHidden, results);
      }
    } catch {
      // Skip inaccessible entries
    }
  }
}
