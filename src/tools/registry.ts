import type { AgentState } from '../types/state.js';

// Tool imports
import { listDirectory } from './repo/listDirectory.js';
import { readFile } from './repo/readFile.js';
import { readFilesBatch } from './repo/readFilesBatch.js';
import { grepPattern } from './search/grepPattern.js';
import { findFiles } from './search/findFiles.js';
import { parsePackageJson } from './config/parsePackageJson.js';
import { parseNextConfig } from './config/parseNextConfig.js';
import { parseTsconfig } from './config/parseTsconfig.js';
import { parseEnvFile } from './config/parseEnvFile.js';
import { checkGitignore } from './config/checkGitignore.js';
import { compareVersions } from './dependency/compareVersions.js';
import { queryNpmVersions } from './dependency/queryNpmVersions.js';
import { analyzeRouteStructure } from './analysis/analyzeRouteStructure.js';
import { analyzeComponentDirectives } from './analysis/analyzeComponentDirectives.js';
import { analyzeEnvUsage } from './analysis/analyzeEnvUsage.js';
import { analyzeMiddleware } from './analysis/analyzeMiddleware.js';
import { recordFinding } from './analysis/recordFinding.js';
import { webSearch } from './web/webSearch.js';
import { fetchUrl } from './web/fetchUrl.js';

/**
 * Execute a tool call and return the JSON result string.
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  state: AgentState,
) => Promise<string>;

/**
 * Normalize path arguments from the LLM.
 * The LLM sometimes passes absolute paths like "/" or "/src" instead of
 * relative paths. Strip leading slashes so path.resolve(repoRoot, p)
 * stays within the repo.
 */
export function normalizePathArgs(args: Record<string, unknown>): Record<string, unknown> {
  const PATH_KEYS = ['path', 'repoPath'];
  for (const key of PATH_KEYS) {
    if (typeof args[key] === 'string') {
      // Strip leading slashes; treat "/" and "." as empty (repo root)
      let p = (args[key] as string).replace(/^[/\\]+/, '');
      if (p === '.' || p === '') p = '.';
      args[key] = p;
    }
  }
  // Also normalize arrays of paths (e.g. read_files_batch)
  // LLM sometimes sends paths as a stringified JSON array instead of an actual array
  if (typeof args['paths'] === 'string') {
    try {
      const parsed = JSON.parse(args['paths'] as string);
      if (Array.isArray(parsed)) {
        args['paths'] = parsed;
      }
    } catch {
      // Not valid JSON — ignore, will fail downstream with a clear error
    }
  }
  if (Array.isArray(args['paths'])) {
    args['paths'] = (args['paths'] as string[]).map((p) => p.replace(/^[/\\]+/, '') || '.');
  }
  return args;
}

/**
 * Execute a tool by name. Returns the JSON result as a string for the LLM.
 */
export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  state: AgentState,
): Promise<string> {
  const args = normalizePathArgs({ ...rawArgs });
  const repoRoot = state.repo.localPath;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are dynamically typed from LLM JSON
  const a = args as any;

  try {
    let result: unknown;

    switch (name) {
      // Repo tools
      case 'list_directory':
        result = await listDirectory(repoRoot, a);
        break;
      case 'read_file':
        result = await readFile(repoRoot, a);
        state.filesRead.add(a.path);
        break;
      case 'read_files_batch':
        result = await readFilesBatch(repoRoot, a);
        for (const p of a.paths ?? []) state.filesRead.add(p);
        break;

      // Search tools
      case 'grep_pattern':
        result = await grepPattern(repoRoot, a);
        break;
      case 'find_files':
        result = await findFiles(repoRoot, a);
        break;

      // Config tools
      case 'parse_package_json':
        result = await parsePackageJson(repoRoot, a);
        break;
      case 'parse_next_config':
        result = await parseNextConfig(repoRoot, a);
        break;
      case 'parse_tsconfig':
        result = await parseTsconfig(repoRoot, a);
        break;
      case 'parse_env_file':
        result = await parseEnvFile(repoRoot, a);
        break;
      case 'check_gitignore':
        result = await checkGitignore(repoRoot, a);
        break;

      // Dependency tools
      case 'compare_versions':
        result = compareVersions(a);
        break;
      case 'query_npm_versions':
        result = await queryNpmVersions(a);
        break;

      // Analysis tools
      case 'analyze_route_structure':
        result = await analyzeRouteStructure(repoRoot, a);
        break;
      case 'analyze_component_directives':
        result = await analyzeComponentDirectives(repoRoot, a);
        break;
      case 'analyze_env_usage':
        result = await analyzeEnvUsage(repoRoot, a);
        break;
      case 'analyze_middleware':
        result = await analyzeMiddleware(repoRoot, a);
        break;
      case 'record_finding':
        result = recordFinding(state, a);
        break;

      // Web tools
      case 'web_search':
        state.webSearchCount++;
        result = await webSearch(a);
        break;
      case 'fetch_url':
        state.urlFetchCount++;
        result = await fetchUrl(a);
        break;

      // Output assembly (handled specially by the runner)
      case 'assemble_output':
        result = { status: 'acknowledged', message: 'Output assembly triggered.' };
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      error: `Tool ${name} failed: ${(err as Error).message}`,
    });
  }
}
