/**
 * Shared utility: resolve a path within a repo root and read the file.
 * Guards against path traversal. Used by read_file, read_files_batch,
 * and config parsing tools.
 */

import { readFile, stat, readdir, open } from 'node:fs/promises';
import path from 'node:path';

/** Extensions that are always binary — skip without reading. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.tiff', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.exe', '.dll', '.so', '.dylib', '.node', '.wasm',
]);

/** Check first N bytes for null bytes — indicates binary content. */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    await fh.close();
  }
}

/** Simple Levenshtein distance for file name suggestions. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Find similar filenames in the same directory. */
async function suggestSimilar(repoRoot: string, filePath: string): Promise<string[]> {
  const dir = path.dirname(path.resolve(repoRoot, filePath));
  const target = path.basename(filePath);
  try {
    const entries = await readdir(dir);
    return entries
      .map((name) => ({ name, dist: levenshtein(target.toLowerCase(), name.toLowerCase()) }))
      .filter((e) => e.dist <= 3 && e.dist > 0)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map((e) => e.name);
  } catch {
    return [];
  }
}

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
  startLine?: number,
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

    // Fast-path binary check by extension
    const ext = path.extname(resolved).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return { error: `Binary file detected: ${filePath}. Use a specialized tool to inspect binary content.` };
    }

    // Content-based binary check (first 8KB)
    if (await isBinaryFile(resolved)) {
      return { error: `Binary file detected: ${filePath}. Use a specialized tool to inspect binary content.` };
    }

    const raw = await readFile(resolved, 'utf-8');
    const lines = raw.split('\n');
    const lineCount = lines.length;

    let content: string;
    const start = startLine ? Math.max(0, startLine - 1) : 0; // convert 1-based to 0-based
    const effectiveMaxLines = maxLines ?? lineCount;
    const end = Math.min(start + effectiveMaxLines, lineCount);

    // Budget: keep content under 60K chars so JSON serialization stays under
    // the 65K spillAndTruncate limit. Drop lines from the end at line boundaries
    // rather than letting spillAndTruncate slice mid-line downstream.
    const CONTENT_BUDGET = 60_000;

    if (start > 0 || end < lineCount) {
      const sliced = lines.slice(start, end);
      content = sliced.join('\n');
      if (content.length > CONTENT_BUDGET) {
        let trimEnd = sliced.length;
        let len = content.length;
        while (len > CONTENT_BUDGET && trimEnd > 0) {
          trimEnd--;
          len -= sliced[trimEnd].length + 1;
        }
        content = sliced.slice(0, trimEnd).join('\n');
        const shownEnd = start + trimEnd;
        content += `\n... (showing lines ${start + 1}-${shownEnd} of ${lineCount} total. Use startLine=${shownEnd + 1} to read more.)`;
      } else if (start > 0 || end < lineCount) {
        content += `\n... (showing lines ${start + 1}-${Math.min(end, lineCount)} of ${lineCount} total)`;
      }
    } else {
      content = raw;
      if (content.length > CONTENT_BUDGET) {
        let trimEnd = lines.length;
        let len = content.length;
        while (len > CONTENT_BUDGET && trimEnd > 0) {
          trimEnd--;
          len -= lines[trimEnd].length + 1;
        }
        content = lines.slice(0, trimEnd).join('\n');
        content += `\n... (showing lines 1-${trimEnd} of ${lineCount} total. Use startLine=${trimEnd + 1} to read more.)`;
      }
    }

    return { content, absolutePath: resolved, lineCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      const suggestions = await suggestSimilar(repoRoot, filePath);
      if (suggestions.length > 0) {
        return { error: `File not found: ${filePath}. Did you mean: ${suggestions.join(', ')}?` };
      }
      return { error: `File not found: ${filePath}` };
    }
    return { error: msg };
  }
}
