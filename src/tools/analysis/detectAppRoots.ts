import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { DetectAppRootsInput, DetectAppRootsOutput, AppRoot } from '../../types/tools.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.cache', 'coverage']);
const DEFAULT_MAX_DEPTH = 4;

/** Config files that indicate a framework without needing a package.json dep check. */
const CONFIG_FRAMEWORK_MAP: [RegExp, AppRoot['type'], string][] = [
  [/^remix\.config\./,   'remix',   'remix'],
  [/^svelte\.config\./,  'svelte',  'svelte'],
  [/^nuxt\.config\./,    'nuxt',    'nuxt'],
  [/^astro\.config\./,   'astro',   'astro'],
  [/^angular\.json$/,    'angular', 'angular'],
];

/** Non-JS manifest files that indicate a language ecosystem root. */
const NON_JS_MANIFESTS: [string | RegExp, AppRoot['type'], string][] = [
  ['Gemfile',           'ruby',   'ruby'],
  ['go.mod',            'go',     'go'],
  ['requirements.txt',  'python', 'python'],
  ['pyproject.toml',    'python', 'python'],
  ['Pipfile',           'python', 'python'],
  ['Cargo.toml',        'rust',   'rust'],
  ['composer.json',     'php',    'php'],
  [/\.csproj$/,         'dotnet', 'dotnet'],
  [/\.sln$/,            'dotnet', 'dotnet'],
];

/** Known plugin packages → plugin label. */
const PLUGIN_MAP: [string | RegExp, string][] = [
  ['prisma',            'prisma'],
  ['@prisma/client',    'prisma'],
  ['tailwindcss',       'tailwind'],
  ['graphql',           'graphql'],
  ['@apollo/client',    'graphql'],
  ['urql',              'graphql'],
  [/^@storybook\//,     'storybook'],
  [/^@sitecore-jss\//,  'sitecore-jss'],
  [/^@remkoj\/optimizely-/, 'optimizely-cms'],
  ['jest',              'jest'],
  ['vitest',            'vitest'],
  ['mocha',             'mocha'],
];

export async function detectAppRoots(
  repoRoot: string,
  input: DetectAppRootsInput,
): Promise<DetectAppRootsOutput> {
  const scanRoot = input.repoPath ? path.resolve(repoRoot, input.repoPath) : repoRoot;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const roots: AppRoot[] = [];

  await scanDirectories(scanRoot, repoRoot, 0, maxDepth, roots);

  // Sort by path depth (shallowest first)
  roots.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  // Detect monorepo tooling from the root
  const monorepoTool = await detectMonorepoTool(repoRoot);
  const isMonorepo = roots.length > 1 || monorepoTool !== undefined;

  return { roots, isMonorepo, monorepoTool };
}

/**
 * Scan directories for app roots: package.json files (JS ecosystem)
 * and non-JS manifest files (Ruby, Go, Python, Rust, PHP, .NET).
 */
async function scanDirectories(
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

  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const relativePath = path.relative(repoRoot, dir).replace(/\\/g, '/') || '.';

  // Check for package.json (JS ecosystem)
  if (fileNames.includes('package.json')) {
    const appRoot = await classifyJsAppRoot(dir, relativePath, fileNames);
    results.push(appRoot);
  }

  // Check for non-JS manifest files (only if no package.json already found)
  if (!fileNames.includes('package.json')) {
    for (const [pattern, type, framework] of NON_JS_MANIFESTS) {
      const found = typeof pattern === 'string'
        ? fileNames.includes(pattern)
        : fileNames.some((f) => pattern.test(f));
      if (found) {
        results.push({ path: relativePath, type, hasPackageJson: false, framework });
        break; // one root per directory
      }
    }
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    await scanDirectories(path.join(dir, entry.name), repoRoot, depth + 1, maxDepth, results);
  }
}

async function classifyJsAppRoot(
  dir: string,
  relativePath: string,
  fileNames: string[],
): Promise<AppRoot> {
  const root: AppRoot = {
    path: relativePath,
    type: 'unknown',
    hasPackageJson: true,
  };

  let allDeps: Record<string, string> = {};
  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return root;
  }

  // 1. Config-based detection (takes priority)
  for (const [pattern, type, framework] of CONFIG_FRAMEWORK_MAP) {
    if (fileNames.some((f) => pattern.test(f))) {
      root.type = type;
      root.framework = framework;
      // Pull version from deps if available
      root.frameworkVersion = allDeps[framework];
      break;
    }
  }

  // 2. Vue detection: needs config + dep (vite.config alone is ambiguous)
  if (root.type === 'unknown' && allDeps['vue']) {
    if (fileNames.some((f) => /^vue\.config\./.test(f)) || fileNames.some((f) => /^vite\.config\./.test(f))) {
      root.type = 'vue';
      root.framework = 'vue';
      root.frameworkVersion = allDeps['vue'];
    }
  }

  // 3. Package.json dep-based detection (fallback)
  if (root.type === 'unknown') {
    if (allDeps['next']) {
      root.type = 'nextjs';
      root.framework = 'next';
      root.frameworkVersion = allDeps['next'];
    } else if (allDeps['react']) {
      root.type = 'react';
      root.framework = 'react';
      root.frameworkVersion = allDeps['react'];
    } else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa']) {
      root.type = 'node';
      root.framework = allDeps['express'] ? 'express' : allDeps['fastify'] ? 'fastify' : 'koa';
      root.frameworkVersion = allDeps[root.framework];
    } else {
      root.type = 'node';
    }
  }

  // 4. Plugin detection
  const plugins = detectPlugins(allDeps);
  if (plugins.length > 0) {
    root.plugins = plugins;
  }

  return root;
}

function detectPlugins(allDeps: Record<string, string>): string[] {
  const seen = new Set<string>();
  for (const [pattern, label] of PLUGIN_MAP) {
    if (seen.has(label)) continue;
    if (typeof pattern === 'string') {
      if (allDeps[pattern]) seen.add(label);
    } else {
      if (Object.keys(allDeps).some((k) => pattern.test(k))) seen.add(label);
    }
  }
  return [...seen];
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
