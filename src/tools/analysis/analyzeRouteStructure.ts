import { readdir, stat as fsStat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeRouteStructureInput, AnalyzeRouteStructureOutput, RouteEntry } from '../../types/tools.js';

export async function analyzeRouteStructure(
  repoRoot: string,
  input: AnalyzeRouteStructureInput,
): Promise<AnalyzeRouteStructureOutput> {
  const basePath = path.resolve(repoRoot, input.repoPath || '.');
  const pagesDir = path.join(basePath, 'src', 'pages');
  const appDir = path.join(basePath, 'src', 'app');

  const hasPages = await dirExists(pagesDir);
  const hasApp = await dirExists(appDir);

  const routes: RouteEntry[] = [];
  const apiRoutes: RouteEntry[] = [];
  const dynamicRoutes: RouteEntry[] = [];
  const catchAllRoutes: RouteEntry[] = [];

  if (hasPages) {
    await scanPages(pagesDir, pagesDir, repoRoot, routes, apiRoutes, dynamicRoutes, catchAllRoutes);
  }

  if (hasApp) {
    await scanAppDir(appDir, appDir, repoRoot, routes, apiRoutes, dynamicRoutes, catchAllRoutes);
  }

  const routerType = hasPages && hasApp ? 'hybrid' : hasApp ? 'app' : hasPages ? 'pages' : 'pages';

  return { routerType, routes, apiRoutes, dynamicRoutes, catchAllRoutes };
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const s = await fsStat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function scanPages(
  dir: string,
  pagesRoot: string,
  repoRoot: string,
  routes: RouteEntry[],
  apiRoutes: RouteEntry[],
  dynamicRoutes: RouteEntry[],
  catchAllRoutes: RouteEntry[],
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
      await scanPages(fullPath, pagesRoot, repoRoot, routes, apiRoutes, dynamicRoutes, catchAllRoutes);
    } else if (stats.isFile() && /\.(tsx?|jsx?|mjs)$/.test(name)) {
      const relativeToPagesRoot = path.relative(pagesRoot, fullPath).replace(/\\/g, '/');
      const relativeToRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

      // Skip _app, _document, _error
      if (name.startsWith('_')) continue;

      const content = await readFile(fullPath, 'utf-8').catch(() => '');
      const routePath = filePathToRoute(relativeToPagesRoot);
      const isDynamic = /\[/.test(name);
      const isCatchAll = /\[\.\.\..+\]/.test(name);
      const isApi = relativeToPagesRoot.startsWith('api/');
      const params = extractParams(name);

      const entry: RouteEntry = {
        filePath: relativeToRepo,
        routePath,
        isDynamic,
        ...(params.length ? { params } : {}),
        hasGetStaticProps: /getStaticProps/.test(content),
        hasGetServerSideProps: /getServerSideProps/.test(content),
        hasGenerateStaticParams: /generateStaticParams/.test(content),
        isServerComponent: !content.includes("'use client'") && !content.includes('"use client"'),
      };

      routes.push(entry);
      if (isApi) apiRoutes.push(entry);
      if (isDynamic) dynamicRoutes.push(entry);
      if (isCatchAll) catchAllRoutes.push(entry);
    }
  }
}

/**
 * Scan App Router directory for route segments.
 * In App Router, routes are defined by page.tsx, route.tsx, layout.tsx files
 * inside directory segments like [param], [[...catchAll]], etc.
 */
async function scanAppDir(
  dir: string,
  appRoot: string,
  repoRoot: string,
  routes: RouteEntry[],
  apiRoutes: RouteEntry[],
  dynamicRoutes: RouteEntry[],
  catchAllRoutes: RouteEntry[],
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
      await scanAppDir(fullPath, appRoot, repoRoot, routes, apiRoutes, dynamicRoutes, catchAllRoutes);
    } else if (stats.isFile() && /^(page|route|layout)\.(tsx?|jsx?|mjs)$/.test(name)) {
      const relativeToAppRoot = path.relative(appRoot, path.dirname(fullPath)).replace(/\\/g, '/');
      const relativeToRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      const content = await readFile(fullPath, 'utf-8').catch(() => '');

      const routePath = appDirToRoute(relativeToAppRoot);
      const isDynamic = /\[/.test(relativeToAppRoot);
      const isCatchAll = /\[\[?\.\.\..+\]\]?/.test(relativeToAppRoot);
      const isApi = name.startsWith('route.');
      const params = extractAppParams(relativeToAppRoot);

      const entry: RouteEntry = {
        filePath: relativeToRepo,
        routePath,
        isDynamic,
        ...(params.length ? { params } : {}),
        hasGetStaticProps: false,
        hasGetServerSideProps: false,
        hasGenerateStaticParams: /generateStaticParams/.test(content),
        isServerComponent: !content.includes("'use client'") && !content.includes('"use client"'),
      };

      routes.push(entry);
      if (isApi) apiRoutes.push(entry);
      if (isDynamic) dynamicRoutes.push(entry);
      if (isCatchAll) catchAllRoutes.push(entry);
    }
  }
}

function appDirToRoute(relPath: string): string {
  if (!relPath || relPath === '.') return '/';

  let route = '/' + relPath
    // Remove route groups like (marketing)
    .replace(/\([^)]+\)\/?/g, '')
    // Convert [[...param]] to *param
    .replace(/\[\[\.\.\.(\w+)\]\]/g, '*$1')
    // Convert [...param] to *param
    .replace(/\[\.\.\.(\w+)\]/g, '*$1')
    // Convert [param] to :param
    .replace(/\[(\w+)\]/g, ':$1');

  // Clean up double slashes
  route = route.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return route;
}

function extractAppParams(relPath: string): string[] {
  const params: string[] = [];
  const matches = relPath.matchAll(/\[(?:\[)?(?:\.\.\.)?(\w+)\](?:\])?/g);
  for (const [, param] of matches) {
    params.push(param);
  }
  return params;
}

function filePathToRoute(filePath: string): string {
  let route = '/' + filePath
    .replace(/\.(tsx?|jsx?|mjs)$/, '')
    .replace(/\/index$/, '')
    .replace(/\\/g, '/');

  // Convert [param] to :param
  route = route.replace(/\[\.\.\.(\w+)\]/g, '*$1');
  route = route.replace(/\[(\w+)\]/g, ':$1');

  return route || '/';
}

function extractParams(filename: string): string[] {
  const params: string[] = [];
  const matches = filename.matchAll(/\[(?:\.\.\.)?(\w+)\]/g);
  for (const [, param] of matches) {
    params.push(param);
  }
  return params;
}
