import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { GrepPatternInput, GrepPatternOutput, GrepMatch } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);
const DEFAULT_MAX_RESULTS = 50;

export async function grepPattern(
  repoRoot: string,
  input: GrepPatternInput,
): Promise<GrepPatternOutput> {
  const searchPath = input.path ? path.resolve(repoRoot, input.path) : repoRoot;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const regex = input.isRegex ? new RegExp(input.pattern, 'g') : null;
  const matches: GrepMatch[] = [];

  // Check that search path exists
  try {
    await access(searchPath);
  } catch {
    return {
      matches: [],
      error: `Search path "${input.path ?? '.'}" does not exist. Use "." to search from the repo root.`,
    };
  }

  await searchDir(searchPath, repoRoot, input.pattern, regex, input.fileGlob, maxResults, matches);
  return { matches };
}

async function searchDir(
  dir: string,
  repoRoot: string,
  pattern: string,
  regex: RegExp | null,
  fileGlob: string | undefined,
  maxResults: number,
  results: GrepMatch[],
): Promise<void> {
  if (results.length >= maxResults) return;

  // Reject excluded paths
  const relative = path.relative(repoRoot, dir);
  for (const part of relative.split(path.sep)) {
    if (EXCLUDED_DIRS.has(part)) return;
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (results.length >= maxResults) return;
    if (EXCLUDED_DIRS.has(name)) continue;

    const fullPath = path.join(dir, name);
    const stat = await import('node:fs/promises').then((fs) => fs.stat(fullPath)).catch(() => null);
    if (!stat) continue;

    if (stat.isDirectory()) {
      await searchDir(fullPath, repoRoot, pattern, regex, fileGlob, maxResults, results);
    } else if (stat.isFile()) {
      if (fileGlob && !matchGlob(name, fileGlob)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) return;

          const line = lines[i];
          const found = regex ? regex.test(line) : line.includes(pattern);
          if (regex) regex.lastIndex = 0; // reset stateful regex

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
        // Skip binary/unreadable files
      }
    }
  }
}

function matchGlob(filename: string, glob: string): boolean {
  // Simple glob: *.ext
  if (glob.startsWith('*.')) {
    return filename.endsWith(glob.slice(1));
  }
  return filename === glob;
}
