import { readdir, stat as fsStat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeComponentDirectivesInput, AnalyzeComponentDirectivesOutput } from '../../types/tools.js';

export async function analyzeComponentDirectives(
  repoRoot: string,
  input: AnalyzeComponentDirectivesInput,
): Promise<AnalyzeComponentDirectivesOutput> {
  const targetPath = path.resolve(repoRoot, input.path);
  const clientPaths: string[] = [];
  let total = 0;

  await scan(targetPath, repoRoot, clientPaths, { total: 0 });
  total = clientPaths.length + (await countAll(targetPath)) - clientPaths.length;

  // Rescan to get accurate total
  const allFiles: string[] = [];
  await collectComponents(targetPath, allFiles);
  total = allFiles.length;

  const clientComponents = clientPaths.length;
  const serverComponents = total - clientComponents;

  return {
    total,
    clientComponents,
    serverComponents,
    clientRatio: total > 0 ? clientComponents / total : 0,
    clientComponentPaths: clientPaths,
  };
}

async function scan(
  dir: string,
  repoRoot: string,
  clientPaths: string[],
  _counter: { total: number },
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    const fullPath = path.join(dir, name);
    const stats = await fsStat(fullPath).catch(() => null);
    if (!stats) continue;

    if (stats.isDirectory()) {
      await scan(fullPath, repoRoot, clientPaths, _counter);
    } else if (stats.isFile() && /\.(tsx?|jsx?)$/.test(name)) {
      const content = await readFile(fullPath, 'utf-8').catch(() => '');
      const firstLine = content.split('\n')[0];
      if (firstLine.includes("'use client'") || firstLine.includes('"use client"')) {
        clientPaths.push(path.relative(repoRoot, fullPath).replace(/\\/g, '/'));
      }
    }
  }
}

async function collectComponents(dir: string, files: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    const fullPath = path.join(dir, name);
    const stats = await fsStat(fullPath).catch(() => null);
    if (!stats) continue;

    if (stats.isDirectory()) {
      await collectComponents(fullPath, files);
    } else if (stats.isFile() && /\.(tsx?|jsx?)$/.test(name)) {
      files.push(fullPath);
    }
  }
}

async function countAll(dir: string): Promise<number> {
  const files: string[] = [];
  await collectComponents(dir, files);
  return files.length;
}
