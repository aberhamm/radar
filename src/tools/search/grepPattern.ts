import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, access } from 'node:fs/promises';
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
    };
  }

  // Try ripgrep first, fall back to Node.js walker
  try {
    return await grepWithRipgrep(repoRoot, searchPath, input);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
      return await grepWithNodeWalker(repoRoot, searchPath, input);
    }
    throw e;
  }
}

async function grepWithRipgrep(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
): Promise<GrepPatternOutput> {
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const args: string[] = [
    '--json',
    '-C', '1',
    '--max-count', String(maxResults),
  ];

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
    const result = await execFileAsync('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      cwd: repoRoot,
    });
    stdout = result.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; message?: string };
    // Exit code 1 = no matches (normal), code 2 = error
    if (err.code === 1) return { matches: [] };
    // If rg is not found, let the caller catch and fall back
    if (err.message?.includes('ENOENT') || err.message?.includes('not found') || err.message?.includes('not recognized')) {
      throw e;
    }
    // Other error — return what we have or empty
    if (err.stdout) { stdout = err.stdout; } else { return { matches: [] }; }
  }

  const matches: GrepMatch[] = [];
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    if (matches.length >= maxResults) break;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'match') {
        const data = parsed.data;
        const filePath = path.relative(repoRoot, data.path.text).replace(/\\/g, '/');
        const lineNumber: number = data.line_number;
        const lineText: string = (data.lines.text ?? '').trimEnd();

        const context: string[] = [lineText];

        matches.push({ filePath, lineNumber, line: lineText, context });
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  return { matches };
}

// --- Node.js fallback walker (used when rg is not installed) ---

async function grepWithNodeWalker(
  repoRoot: string,
  searchPath: string,
  input: GrepPatternInput,
): Promise<GrepPatternOutput> {
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const regex = input.isRegex ? new RegExp(input.pattern, 'g') : null;
  const matches: GrepMatch[] = [];
  await walkDir(searchPath, repoRoot, input.pattern, regex, input.fileGlob, maxResults, matches);
  return { matches };
}

async function walkDir(
  dir: string,
  repoRoot: string,
  pattern: string,
  regex: RegExp | null,
  fileGlob: string | undefined,
  maxResults: number,
  results: GrepMatch[],
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
      await walkDir(fullPath, repoRoot, pattern, regex, fileGlob, maxResults, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      if (fileGlob && !matchGlob(entry.name, fileGlob)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
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

            results.push({
              filePath: relativePath,
              lineNumber: i + 1,
              line: line.trimEnd(),
              context,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

function matchGlob(filename: string, glob: string): boolean {
  const globs = glob.split(',').map((g) => g.trim());
  return globs.some((g) => {
    if (g.startsWith('*.')) return filename.endsWith(g.slice(1));
    return filename === g;
  });
}
