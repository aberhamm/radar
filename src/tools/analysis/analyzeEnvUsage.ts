import { readdir, stat as fsStat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeEnvUsageInput, AnalyzeEnvUsageOutput, EnvUsageMatch } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

export async function analyzeEnvUsage(
  repoRoot: string,
  input: AnalyzeEnvUsageInput,
): Promise<AnalyzeEnvUsageOutput> {
  const basePath = path.resolve(repoRoot, input.repoPath || '.');
  const usages: EnvUsageMatch[] = [];

  await scanDir(basePath, repoRoot, usages);

  const publicCount = usages.filter((u) => u.isPublic).length;
  const serverCount = usages.filter((u) => !u.isPublic).length;

  return { usages, publicCount, serverCount };
}

async function scanDir(
  dir: string,
  repoRoot: string,
  usages: EnvUsageMatch[],
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
    const stats = await fsStat(fullPath).catch(() => null);
    if (!stats) continue;

    if (stats.isDirectory()) {
      await scanDir(fullPath, repoRoot, usages);
    } else if (stats.isFile() && /\.(tsx?|jsx?|mjs)$/.test(name)) {
      const content = await readFile(fullPath, 'utf-8').catch(() => '');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].matchAll(/process\.env\.(\w+)/g);
        for (const match of matches) {
          const variable = match[1];
          usages.push({
            filePath: path.relative(repoRoot, fullPath).replace(/\\/g, '/'),
            lineNumber: i + 1,
            variable,
            isPublic: variable.startsWith('NEXT_PUBLIC_'),
          });
        }
      }
    }
  }
}
