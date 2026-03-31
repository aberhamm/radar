/**
 * Shared utility: resolve a path within a repo root and read the file.
 * Guards against path traversal. Used by read_file, read_files_batch,
 * and config parsing tools.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ResolvedFile {
  content: string;
  absolutePath: string;
  lineCount: number;
}

export interface ResolveError {
  error: string;
}

export type ResolveResult = ResolvedFile | ResolveError;

export function isResolveError(r: ResolveResult): r is ResolveError {
  return 'error' in r;
}

/**
 * Resolve a file path relative to repoRoot, validate it's within bounds,
 * and read it. Returns content or an error object (never throws).
 */
export async function resolveAndRead(
  repoRoot: string,
  filePath: string,
  maxLines?: number,
): Promise<ResolveResult> {
  try {
    const resolved = path.resolve(repoRoot, filePath);
    const normalizedRoot = path.resolve(repoRoot);

    // Path traversal guard
    if (!resolved.startsWith(normalizedRoot)) {
      return { error: `Path traversal rejected: ${filePath}` };
    }

    // Reject node_modules and .git
    const relative = path.relative(normalizedRoot, resolved);
    if (relative.includes('node_modules') || relative.split(path.sep).includes('.git')) {
      return { error: `Excluded path: ${filePath}` };
    }

    const stats = await stat(resolved);
    if (!stats.isFile()) {
      return { error: `Not a file: ${filePath}` };
    }

    const raw = await readFile(resolved, 'utf-8');
    const lines = raw.split('\n');
    const lineCount = lines.length;

    let content: string;
    if (maxLines && lineCount > maxLines) {
      content = lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lineCount} total lines)`;
    } else {
      content = raw;
    }

    return { content, absolutePath: resolved, lineCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return { error: `File not found: ${filePath}` };
    }
    return { error: msg };
  }
}
