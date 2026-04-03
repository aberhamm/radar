import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { DetectAppRootsInput, DetectAppRootsOutput, AppRoot } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.cache', 'coverage']);
const DEFAULT_MAX_DEPTH = 4;

export async function detectAppRoots(
  repoRoot: string,
  input: DetectAppRootsInput,
): Promise<DetectAppRootsOutput> {
  const scanRoot = input.repoPath ? path.resolve(repoRoot, input.repoPath) : repoRoot;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const roots: AppRoot[] = [];

  await scanForPackageJsons(scanRoot, repoRoot, 0, maxDepth, roots);

  // Sort by path depth (shallowest first)
  roots.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  // Detect monorepo tooling from the root
  const monorepoTool = await detectMonorepoTool(repoRoot);
  const isMonorepo = roots.length > 1 || monorepoTool !== undefined;

  return { roots, isMonorepo, monorepoTool };
}

async function scanForPackageJsons(
  dir: string,
  repoRoot: string,
  depth: number,
  maxDepth: number,
  results: AppRoot[],
): Promise<void> {
  if (depth > maxDepth) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Check if this directory has a package.json
  const hasPkg = entries.some((e) => e.isFile() && e.name === 'package.json');
  if (hasPkg) {
    const relativePath = path.relative(repoRoot, dir).replace(/\\/g, '/') || '.';
    const appRoot = await classifyAppRoot(dir, relativePath);
    results.push(appRoot);
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    await scanForPackageJsons(path.join(dir, entry.name), repoRoot, depth + 1, maxDepth, results);
  }
}

async function classifyAppRoot(dir: string, relativePath: string): Promise<AppRoot> {
  const root: AppRoot = {
    path: relativePath,
    type: 'unknown',
    hasPackageJson: true,
  };

  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['next']) {
      root.type = 'nextjs';
      root.framework = 'next';
    } else if (allDeps['react']) {
      root.type = 'react';
      root.framework = 'react';
    } else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa']) {
      root.type = 'node';
      root.framework = allDeps['express'] ? 'express' : allDeps['fastify'] ? 'fastify' : 'koa';
    } else {
      root.type = 'node';
    }
  } catch {
    // Can't read/parse package.json
  }

  return root;
}

async function detectMonorepoTool(repoRoot: string): Promise<string | undefined> {
  const checks: [string, string][] = [
    ['lerna.json', 'lerna'],
    ['nx.json', 'nx'],
    ['turbo.json', 'turborepo'],
    ['pnpm-workspace.yaml', 'pnpm-workspaces'],
  ];

  for (const [file, tool] of checks) {
    try {
      await access(path.join(repoRoot, file));
      return tool;
    } catch {
      // not found
    }
  }

  // Check for yarn/npm workspaces in root package.json
  try {
    const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    if (pkg.workspaces) return 'npm-workspaces';
  } catch {
    // no root package.json
  }

  return undefined;
}
