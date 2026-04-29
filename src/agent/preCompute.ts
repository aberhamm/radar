/**
 * Pre-computation layer — runs deterministic tools before the agent loop starts.
 *
 * The agent's first few turns are predictable: detect app roots, read package.json,
 * list the file tree, and fetch specialist checklists. Running these tools eagerly
 * and injecting results into the goal prompt saves 3-5 LLM round-trips.
 *
 * Two-phase execution:
 *   Phase 1: detectAppRoots, parsePackageJson, listDirectory run in parallel.
 *   Phase 2: getSpecialistPrompts chains from Phase 1 app roots.
 *
 * All failures are graceful — the agent proceeds without whatever tool failed.
 */

import path from 'node:path';
import { detectAppRoots } from '../tools/analysis/detectAppRoots.js';
import { parsePackageJson } from '../tools/config/parsePackageJson.js';
import { listDirectory } from '../tools/repo/listDirectory.js';
import { getSpecialistPrompts } from '../tools/analysis/getSpecialistPrompts.js';

/** Collected results from pre-computation. Each field is optional — a tool failure leaves it undefined. */
export interface PreComputeResult {
  appRoots?: Awaited<ReturnType<typeof detectAppRoots>>;
  packageJson?: Awaited<ReturnType<typeof parsePackageJson>>;
  fileTree?: Awaited<ReturnType<typeof listDirectory>>;
  specialists?: Awaited<ReturnType<typeof getSpecialistPrompts>>;
}

/**
 * Run deterministic tools before the agent loop to seed the initial context.
 * Saves 3-5 LLM round-trips by pre-computing what the agent would discover
 * in its first few turns. Failures are graceful — the agent proceeds without
 * whatever tool failed.
 */
export async function runPreCompute(repoPath: string, appRoot?: string): Promise<PreComputeResult> {
  const result: PreComputeResult = {};

  const scanPath = appRoot ? path.join(repoPath, appRoot) : repoPath;
  const pkgJsonPath = appRoot ? path.join(appRoot, 'package.json') : 'package.json';
  const listPath = appRoot ?? '.';

  // Phase 1: independent tools in parallel (Promise.allSettled — never throws)
  const [appRootsResult, packageJsonResult, fileTreeResult] = await Promise.allSettled([
    detectAppRoots(scanPath, {}),
    parsePackageJson(repoPath, { path: pkgJsonPath }),
    listDirectory(repoPath, { path: listPath, depth: 2 }),
  ]);

  if (appRootsResult.status === 'fulfilled') {
    const roots = appRootsResult.value;
    if (roots.roots.length > 15) {
      const total = roots.roots.length;
      roots.roots = roots.roots.slice(0, 15);
      roots.roots.push({
        path: `... and ${total - 15} more (${total} total)`,
        type: 'unknown',
        hasPackageJson: false,
      });
    }
    result.appRoots = roots;
  }
  if (packageJsonResult.status === 'fulfilled') result.packageJson = packageJsonResult.value;
  if (fileTreeResult.status === 'fulfilled') result.fileTree = fileTreeResult.value;

  // Phase 2: specialist prompts depend on Phase 1 app roots
  if (result.appRoots && result.appRoots.roots.length > 0) {
    try {
      const realRoots = result.appRoots.roots.filter(r => !r.path.startsWith('...'));
      result.specialists = await getSpecialistPrompts({
        roots: realRoots,
        isMonorepo: !!result.appRoots.monorepoTool,
        monorepoTool: result.appRoots.monorepoTool,
      });
    } catch { /* graceful — agent will call get_specialist_prompts itself */ }
  }

  return result;
}

/**
 * Format pre-computed results as a concise context block for the goal prompt.
 */
export function formatPreComputeContext(pre: PreComputeResult): string {
  const sections: string[] = ['PRE-COMPUTED CONTEXT (skip detect_app_roots, get_specialist_prompts, parse_package_json, and list_directory for root — this data is already available):'];

  if (pre.appRoots) {
    const roots = pre.appRoots.roots.map(r => {
      const parts = [r.type, r.frameworkVersion ? `v${r.frameworkVersion}` : null, r.plugins?.length ? `plugins: ${r.plugins.join(', ')}` : null].filter(Boolean);
      return `  ${r.path}: ${parts.join(', ')}`;
    }).join('\n');
    sections.push(`App Roots (${pre.appRoots.roots.length}):\n${roots}`);
    if (pre.appRoots.monorepoTool) sections.push(`Monorepo: ${pre.appRoots.monorepoTool}`);
  }

  if (pre.specialists && pre.specialists.specialists.length > 0) {
    const specs = pre.specialists.specialists.map(s =>
      `  ${s.name} (${s.relevance}): ${s.checklist.slice(0, 150)}${s.checklist.length > 150 ? '...' : ''}`
    ).join('\n');
    sections.push(`Specialist Checklists:\n${specs}`);
  }

  if (pre.packageJson) {
    const pkg = pre.packageJson;
    const depCount = Object.keys(pkg.dependencies).length;
    const devCount = Object.keys(pkg.devDependencies).length;
    const scripts = Object.keys(pkg.scripts).join(', ');
    sections.push(`Package: ${pkg.name} — ${depCount} deps, ${devCount} devDeps, scripts: [${scripts}]`);
  }

  if (pre.fileTree && pre.fileTree.entries) {
    const dirs = pre.fileTree.entries.filter(e => e.type === 'directory').map(e => e.path);
    const files = pre.fileTree.entries.filter(e => e.type === 'file').map(e => e.path);
    sections.push(`File tree (depth 2): ${dirs.length} dirs, ${files.length} files\n  Dirs: ${dirs.slice(0, 20).join(', ')}${dirs.length > 20 ? '...' : ''}\n  Root files: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}`);
  }

  return sections.join('\n\n');
}
