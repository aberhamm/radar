import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, access, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GrepPatternInput, GrepPatternOutput, GrepMatch } from '../../types/tools.js';

const execFileAsync = promisify(execFile);
const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);
const DEFAULT_MAX_RESULTS = 50;

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.tiff', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.exe', '.dll', '.so', '.dylib', '.node', '.wasm',
]);

export async function grepPattern(
  repoRoot: string,
  input: GrepPatternInput,
): Promise<GrepPatternOutput> {
  const searchPath = input.path ? path.resolve(repoRoot, input.path) : repoRoot;

  try {
    await access(searchPath);
  } catch {
    return {
      matches: [],
      error: `Search path "${input.path ?? '.'}" does not exist. Use "." to search from the repo root.`,
      errorCode: 'FILE_NOT_FOUND',
    };
  }

  const mode = input.outputMode ?? 'content';

  // Try ripgrep first, fall back to Node.js walker
  try {
    return await grepWithRipgrep(repoRoot, searchPath, input, mode);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
      return await grepWithNodeWalker(repoRoot, searchPath, input, mode);
    }
    throw e;
  }
}

// --- Ripgrep path ---

async function grepWithRipgrep(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
  mode: 'content' | 'files_with_matches' | 'count',
): Promise<GrepPatternOutput> {
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const offset = input.offset ?? 0;
  // Collect enough for offset + maxResults to slice later
  const collectLimit = offset + maxResults;

  // files_with_matches mode
  if (mode === 'files_with_matches') {
    return await rgFilesWithMatches(repoRoot, searchPath, input, maxResults, offset);
  }

  // count mode
  if (mode === 'count') {
    return await rgCount(repoRoot, searchPath, input);
  }

  // content mode (default)
  const args: string[] = ['--json', '-C', '1', '--max-count', String(collectLimit)];

  if (input.multiline) {
    args.push('-U', '--multiline-dotall');
  }

  for (const dir of EXCLUDED_DIRS) {
    args.push('--glob', `!${dir}`);
  }

  if (input.fileGlob) {
    for (const glob of input.fileGlob.split(',')) {
      args.push('--glob', glob.trim());
    }
  }

  if (input.isRegex) {
    args.push('-e', input.pattern);
  } else {
    args.push('--fixed-strings', '-e', input.pattern);
  }

  args.push(searchPath);

  let stdout: string;
  try {
    const result = await execFileAsync('rg', args, { maxBuffer: 10 * 1024 * 1024, cwd: repoRoot });
    stdout = result.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; message?: string };
    if (err.code === 1) return { matches: [], truncated: false };
    if (err.message?.includes('ENOENT') || err.message?.includes('not found') || err.message?.includes('not recognized')) {
      throw e;
    }
    if (err.stdout) { stdout = err.stdout; } else { return { matches: [], truncated: false }; }
  }

  const allMatches: GrepMatch[] = [];
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    if (allMatches.length >= collectLimit + 1) break; // +1 to detect truncation
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'match') {
        const data = parsed.data;
        const filePath = path.relative(repoRoot, data.path.text).replace(/\\/g, '/');
        const lineNumber: number = data.line_number;
        const lineText: string = (data.lines.text ?? '').trimEnd();
        const context: string[] = [lineText];
        allMatches.push({ filePath, lineNumber, line: lineText, context });
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  const truncated = allMatches.length > offset + maxResults;
  let matches = allMatches.slice(offset, offset + maxResults);

  // Optional mtime sort
  if (input.sortByMtime) {
    matches = await sortMatchesByMtime(repoRoot, matches);
  }

  return { matches, truncated };
}

async function rgFilesWithMatches(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
  maxResults: number,
  offset: number,
): Promise<GrepPatternOutput> {
  const args: string[] = ['--files-with-matches'];

  if (input.multiline) {
    args.push('-U', '--multiline-dotall');
  }

  for (const dir of EXCLUDED_DIRS) {
    args.push('--glob', `!${dir}`);
  }
  if (input.fileGlob) {
    for (const glob of input.fileGlob.split(',')) {
      args.push('--glob', glob.trim());
    }
  }
  if (input.isRegex) {
    args.push('-e', input.pattern);
  } else {
    args.push('--fixed-strings', '-e', input.pattern);
  }
  args.push(searchPath);

  let stdout: string;
  try {
    const result = await execFileAsync('rg', args, { maxBuffer: 10 * 1024 * 1024, cwd: repoRoot });
    stdout = result.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; message?: string };
    if (err.code === 1) return { matches: [], matchedFiles: [], truncated: false };
    if (err.message?.includes('ENOENT') || err.message?.includes('not found') || err.message?.includes('not recognized')) throw e;
    if (err.stdout) { stdout = err.stdout; } else { return { matches: [], matchedFiles: [], truncated: false }; }
  }

  let files = stdout.split('\n').filter(Boolean)
    .map((f) => path.relative(repoRoot, f).replace(/\\/g, '/'));

  if (input.sortByMtime) {
    files = await sortFilesByMtime(repoRoot, files);
  }

  const truncated = files.length > offset + maxResults;
  const matchedFiles = files.slice(offset, offset + maxResults);

  return { matches: [], matchedFiles, truncated };
}

async function rgCount(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
): Promise<GrepPatternOutput> {
  const args: string[] = ['--count-matches'];

  if (input.multiline) {
    args.push('-U', '--multiline-dotall');
  }

  for (const dir of EXCLUDED_DIRS) {
    args.push('--glob', `!${dir}`);
  }
  if (input.fileGlob) {
    for (const glob of input.fileGlob.split(',')) {
      args.push('--glob', glob.trim());
    }
  }
  if (input.isRegex) {
    args.push('-e', input.pattern);
  } else {
    args.push('--fixed-strings', '-e', input.pattern);
  }
  args.push(searchPath);

  let stdout: string;
  try {
    const result = await execFileAsync('rg', args, { maxBuffer: 10 * 1024 * 1024, cwd: repoRoot });
    stdout = result.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; message?: string };
    if (err.code === 1) return { matches: [], fileCounts: {}, truncated: false };
    if (err.message?.includes('ENOENT') || err.message?.includes('not found') || err.message?.includes('not recognized')) throw e;
    if (err.stdout) { stdout = err.stdout; } else { return { matches: [], fileCounts: {}, truncated: false }; }
  }

  const fileCounts: Record<string, number> = {};
  for (const line of stdout.split('\n').filter(Boolean)) {
    const sep = line.lastIndexOf(':');
    if (sep === -1) continue;
    const file = path.relative(repoRoot, line.slice(0, sep)).replace(/\\/g, '/');
    const count = parseInt(line.slice(sep + 1), 10);
    if (!isNaN(count)) fileCounts[file] = count;
  }

  return { matches: [], fileCounts, truncated: false };
}

// --- Node.js fallback walker ---

async function grepWithNodeWalker(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
  mode: 'content' | 'files_with_matches' | 'count',
): Promise<GrepPatternOutput> {
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const offset = input.offset ?? 0;
  const collectLimit = offset + maxResults + 1; // +1 to detect truncation

  if (mode === 'count') {
    const fileCounts: Record<string, number> = {};
    await walkDirCount(searchPath, repoRoot, input, fileCounts);
    return { matches: [], fileCounts, truncated: false };
  }

  if (mode === 'files_with_matches') {
    const matchedFiles: string[] = [];
    await walkDirFilesOnly(searchPath, repoRoot, input, matchedFiles);

    let files = input.sortByMtime ? await sortFilesByMtime(repoRoot, matchedFiles) : matchedFiles;
    const truncated = files.length > offset + maxResults;
    files = files.slice(offset, offset + maxResults);
    return { matches: [], matchedFiles: files, truncated };
  }

  // content mode
  const regex = input.isRegex ? new RegExp(input.pattern, input.multiline ? 'gs' : 'g') : null;
  const allMatches: GrepMatch[] = [];
  await walkDir(searchPath, repoRoot, input.pattern, regex, input.fileGlob, collectLimit, allMatches, input.multiline);

  const truncated = allMatches.length > offset + maxResults;
  let matches = allMatches.slice(offset, offset + maxResults);

  if (input.sortByMtime) {
    matches = await sortMatchesByMtime(repoRoot, matches);
  }

  return { matches, truncated };
}

async function walkDir(
  dir: string,
  repoRoot: string,
  pattern: string,
  regex: RegExp | null,
  fileGlob: string | undefined,
  maxResults: number,
  results: GrepMatch[],
  multiline?: boolean,
): Promise<void> {
  if (results.length >= maxResults) return;

  const relative = path.relative(repoRoot, dir);
  for (const part of relative.split(path.sep)) {
    if (EXCLUDED_DIRS.has(part)) return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, repoRoot, pattern, regex, fileGlob, maxResults, results, multiline);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (fileGlob && !matchGlob(entry.name, fileGlob)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');

        if (multiline && regex) {
          // Multiline matching across the full content
          let match;
          while ((match = regex.exec(content)) !== null && results.length < maxResults) {
            const lineNumber = content.slice(0, match.index).split('\n').length;
            const matchedLine = match[0].split('\n')[0].trimEnd();
            const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
            results.push({ filePath: relativePath, lineNumber, line: matchedLine, context: [matchedLine] });
          }
          if (regex) regex.lastIndex = 0;
        } else {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) return;
            const line = lines[i];
            const found = regex ? regex.test(line) : line.includes(pattern);
            if (regex) regex.lastIndex = 0;

            if (found) {
              const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
              const context: string[] = [];
              if (i > 0) context.push(lines[i - 1]);
              context.push(line);
              if (i < lines.length - 1) context.push(lines[i + 1]);
              results.push({ filePath: relativePath, lineNumber: i + 1, line: line.trimEnd(), context });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

async function walkDirFilesOnly(
  dir: string,
  repoRoot: string,
  input: GrepPatternInput,
  matchedFiles: string[],
): Promise<void> {
  const relative = path.relative(repoRoot, dir);
  for (const part of relative.split(path.sep)) {
    if (EXCLUDED_DIRS.has(part)) return;
  }

  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDirFilesOnly(fullPath, repoRoot, input, matchedFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (input.fileGlob && !matchGlob(entry.name, input.fileGlob)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        const found = input.isRegex ? new RegExp(input.pattern).test(content) : content.includes(input.pattern);
        if (found) {
          matchedFiles.push(path.relative(repoRoot, fullPath).replace(/\\/g, '/'));
        }
      } catch { /* skip */ }
    }
  }
}

async function walkDirCount(
  dir: string,
  repoRoot: string,
  input: GrepPatternInput,
  fileCounts: Record<string, number>,
): Promise<void> {
  const relative = path.relative(repoRoot, dir);
  for (const part of relative.split(path.sep)) {
    if (EXCLUDED_DIRS.has(part)) return;
  }

  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDirCount(fullPath, repoRoot, input, fileCounts);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (input.fileGlob && !matchGlob(entry.name, input.fileGlob)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        const regex = input.isRegex ? new RegExp(input.pattern, 'g') : null;
        let count = 0;
        if (regex) {
          const m = content.match(regex);
          count = m ? m.length : 0;
        } else {
          let idx = 0;
          while ((idx = content.indexOf(input.pattern, idx)) !== -1) {
            count++;
            idx += input.pattern.length;
          }
        }
        if (count > 0) {
          const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
          fileCounts[relPath] = count;
        }
      } catch { /* skip */ }
    }
  }
}

// --- mtime sorting ---

async function sortMatchesByMtime(repoRoot: string, matches: GrepMatch[]): Promise<GrepMatch[]> {
  // Get unique file paths and their mtimes
  const uniqueFiles = [...new Set(matches.map((m) => m.filePath))];
  const mtimeMap = await getMtimeMap(repoRoot, uniqueFiles);

  // Sort: most recent first, preserve original order for same file
  return [...matches].sort((a, b) => {
    const mtimeA = mtimeMap.get(a.filePath) ?? 0;
    const mtimeB = mtimeMap.get(b.filePath) ?? 0;
    return mtimeB - mtimeA;
  });
}

async function sortFilesByMtime(repoRoot: string, files: string[]): Promise<string[]> {
  const mtimeMap = await getMtimeMap(repoRoot, files);
  return [...files].sort((a, b) => {
    const mtimeA = mtimeMap.get(a) ?? 0;
    const mtimeB = mtimeMap.get(b) ?? 0;
    return mtimeB - mtimeA;
  });
}

async function getMtimeMap(repoRoot: string, files: string[]): Promise<Map<string, number>> {
  const mtimeMap = new Map<string, number>();
  // Cap stat calls to prevent pathological cases
  const toStat = files.slice(0, 200);
  await Promise.all(toStat.map(async (f) => {
    try {
      const s = await stat(path.resolve(repoRoot, f));
      mtimeMap.set(f, s.mtimeMs);
    } catch {
      mtimeMap.set(f, 0);
    }
  }));
  return mtimeMap;
}

function matchGlob(filename: string, glob: string): boolean {
  const globs = glob.split(',').map((g) => g.trim());
  return globs.some((g) => {
    if (g.startsWith('*.')) return filename.endsWith(g.slice(1));
    return filename === g;
  });
}
