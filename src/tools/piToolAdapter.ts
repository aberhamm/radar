/**
 * Pi Tool Registry — all tools as Pi AgentTool[] with TypeBox schemas.
 *
 * Each tool's execute() calls the implementation directly, normalizes
 * LLM path arguments, tracks state side effects, and returns Pi's
 * { content, details } result format.
 *
 * All tools are wrapped via makeTool() which runs input validation
 * from validators.ts before execute(). Deferred tools (web_search,
 * fetch_url, compare_versions) have stub descriptions — use tool_search
 * to discover their full capabilities.
 *
 * Also includes assemble_output, which stores sections in a closure
 * ref for post-loop retrieval by the runner.
 */

import { Type } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { AgentState } from '../types/state.js';
import { VALIDATORS } from './validators.js';
import { createHash } from 'node:crypto';
import { stat as fsStat, open as fsOpen } from 'node:fs/promises';

// Tool implementations
import { cloneRepo } from './repo/cloneRepo.js';
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
import { recordFinding, type FindingProgressEvent } from './analysis/recordFinding.js';
import { webSearch } from './web/webSearch.js';
import { fetchUrl } from './web/fetchUrl.js';
import { detectAppRoots } from './analysis/detectAppRoots.js';
import { detectScopeDrift } from './analysis/detectScopeDrift.js';
import { getSpecialistPrompts } from './analysis/getSpecialistPrompts.js';

import { isReadOnly, isStateful, StatefulToolMutex } from './concurrency.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Sections captured by assemble_output, accessible after agent.prompt() returns. */
export interface AssembledSections {
  sections: Record<string, string> | null;
}

// --- Deferred tool loading ---

const DEFERRED_TOOL_NAMES = new Set(['web_search', 'fetch_url', 'compare_versions']);

interface DeferredToolEntry {
  name: string;
  fullDescription: string;
  parameterNames: string[];
}

const DEFERRED_TOOL_ENTRIES: DeferredToolEntry[] = [
  {
    name: 'web_search',
    fullDescription: 'Search the web for documentation, changelogs, migration guides, and known issues. Filters results through approved documentation sources.',
    parameterNames: ['query', 'siteFilter', 'maxResults'],
  },
  {
    name: 'fetch_url',
    fullDescription: 'Fetch and extract content from a documentation URL. Converts HTML to Markdown via Turndown. Includes LRU cache with 15-min TTL, SSRF protection (domain blocklist), and safe redirect following (cross-host redirects are blocked).',
    parameterNames: ['url', 'maxLength'],
  },
  {
    name: 'compare_versions',
    fullDescription: 'Compare installed package versions against latest available versions from npm. Returns version delta, severity classification (patch/minor/major), and upgrade recommendations for each package.',
    parameterNames: ['installed', 'latest'],
  },
];

// --- makeTool helper ---

/**
 * Wrap a tool definition with input validation from validators.ts.
 * Every tool goes through this — validation runs before execute().
 */
function makeTool(
  name: string,
  label: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any,
  impl: AgentTool['execute'],
): AgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (id, params, signal?, onUpdate?) => {
      const v = VALIDATORS[name];
      if (v) {
        const vErr = v(params as Record<string, unknown>);
        if (vErr) return err(name, new Error(`Validation: ${vErr}`));
      }
      return impl(id, params, signal, onUpdate);
    },
  };
}

// --- File dedup helpers ---

async function isFileUnchanged(state: AgentState, repoRoot: string, filePath: string): Promise<boolean> {
  try {
    const absPath = pathResolve(repoRoot, filePath);
    const stats = await fsStat(absPath);
    const cached = state.fileReadCache.get(filePath);
    if (!cached || cached.mtime !== stats.mtimeMs || cached.size !== stats.size) return false;
    // mtime + size match — sufficient for unchanged detection during a single run
    return true;
  } catch {
    return false;
  }
}

async function updateFileCache(state: AgentState, repoRoot: string, filePath: string, content?: string): Promise<void> {
  try {
    const absPath = pathResolve(repoRoot, filePath);
    const stats = await fsStat(absPath);
    const summary = content ? buildFileSummary(filePath, content) : undefined;
    state.fileReadCache.set(filePath, { mtime: stats.mtimeMs, size: stats.size, summary });
  } catch { /* ignore — dedup is best-effort */ }
}

/**
 * Build a ~300 char summary of file contents for the dedup cache.
 * When a file is re-requested and unchanged, this summary is returned
 * instead of bare "[file_unchanged]" so the agent retains context
 * even after the original full read is compressed away.
 */
function buildFileSummary(filePath: string, content: string): string {
  const lines = content.split('\n');
  const lineCount = lines.length;
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  // Collect structural signals based on file type
  const signals: string[] = [`${lineCount} lines`];

  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    // Extract imports, exports, function/class names
    const imports = lines.filter(l => l.startsWith('import ')).length;
    if (imports > 0) signals.push(`${imports} imports`);
    const exports = lines.filter(l => /^export\s+(default\s+)?/.test(l)).length;
    if (exports > 0) signals.push(`${exports} exports`);
    // Top-level identifiers
    const ids = lines
      .filter(l => /^(export\s+)?(function|const|class|interface|type|enum)\s+\w/.test(l))
      .map(l => l.match(/(?:function|const|class|interface|type|enum)\s+(\w+)/)?.[1])
      .filter(Boolean)
      .slice(0, 8);
    if (ids.length > 0) signals.push(`defines: ${ids.join(', ')}`);
  } else if (ext === 'json') {
    // Top-level keys
    try {
      const keys = Object.keys(JSON.parse(content)).slice(0, 10);
      signals.push(`keys: ${keys.join(', ')}`);
    } catch { /* not parseable */ }
  } else if (ext === 'md') {
    const headings = lines.filter(l => l.startsWith('#')).map(l => l.replace(/^#+\s*/, '')).slice(0, 5);
    if (headings.length > 0) signals.push(`headings: ${headings.join(', ')}`);
  }

  // First meaningful non-blank, non-import line as a content hint
  const firstMeaningful = lines.find(l => l.trim() && !l.startsWith('import ') && !l.startsWith('//') && !l.startsWith('/*'));
  if (firstMeaningful) signals.push(`starts: ${firstMeaningful.trim().slice(0, 60)}`);

  const result = `[${filePath}: ${signals.join(' | ')}]`;
  return result.slice(0, 400);
}

/**
 * Normalize path arguments from the LLM.
 * The LLM sometimes passes absolute paths like "/" or "/src" instead of
 * relative paths, or full filesystem paths like "C:\projects\repo\src".
 * Strip the repo root prefix and leading slashes so path.resolve(repoRoot, p)
 * stays within the repo.
 */
export function normalizePathArgs(args: Record<string, unknown>, repoRoot?: string): Record<string, unknown> {
  const PATH_KEYS = ['path', 'repoPath'];
  for (const key of PATH_KEYS) {
    if (typeof args[key] === 'string') {
      let p = args[key] as string;
      // Strip repo root prefix (LLM sometimes sends full absolute paths)
      if (repoRoot) {
        const normalized = repoRoot.replace(/\\/g, '/');
        p = p.replace(/\\/g, '/');
        if (p.startsWith(normalized)) {
          p = p.slice(normalized.length);
        }
      }
      p = p.replace(/^[/\\]+/, '');
      if (p === '.' || p === '') p = '.';
      args[key] = p;
    }
  }
  // LLM sometimes sends paths as a stringified JSON array instead of an actual array
  if (typeof args['paths'] === 'string') {
    try {
      const parsed = JSON.parse(args['paths'] as string);
      if (Array.isArray(parsed)) {
        args['paths'] = parsed;
      }
    } catch {
      // Not valid JSON — will fail downstream with a clear error
    }
  }
  if (Array.isArray(args['paths'])) {
    const rootNorm = repoRoot?.replace(/\\/g, '/');
    args['paths'] = (args['paths'] as string[]).map((p) => {
      if (rootNorm) {
        p = p.replace(/\\/g, '/');
        if (p.startsWith(rootNorm)) p = p.slice(rootNorm.length);
      }
      return p.replace(/^[/\\]+/, '') || '.';
    });
  }
  return args;
}

/**
 * Per-tool result size limits. Large search/read results get more room;
 * small tools stay tight to keep conversation history lean.
 */
const PER_TOOL_LIMITS: Record<string, number> = {
  grep_pattern: 20_000,
  read_file: 65_000,
  read_files_batch: 65_000,
  fetch_url: 100_000,
  find_files: 20_000,
};
const DEFAULT_RESULT_LIMIT = 4_000;

// --- Disk spill for oversized results ---

/**
 * Create a per-run spill directory and return { getDir, spillAndTruncate, cleanup }.
 * Each run gets its own isolated spill dir to avoid races in parallel runs.
 */
export function createSpillContext(): {
  spillAndTruncate: (toolName: string, resultJson: string) => string;
  cleanup: () => void;
} {
  let dir: string | null = null;

  function getDir(): string {
    if (!dir) {
      dir = join(tmpdir(), `repo-audit-${randomUUID().slice(0, 8)}`);
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  function spillAndTruncate(toolName: string, resultJson: string): string {
    const limit = PER_TOOL_LIMITS[toolName] ?? DEFAULT_RESULT_LIMIT;
    if (resultJson.length <= limit) return resultJson;

    const omitted = resultJson.length - limit;
    // Structure-aware truncation: try to cut at a clean boundary
    // so the LLM sees valid JSON rather than garbled mid-key slicing.
    const truncated = truncateAtBoundary(resultJson, limit);
    try {
      const d = getDir();
      const filename = `${toolName}-${Date.now()}.json`;
      const filepath = join(d, filename);
      writeFileSync(filepath, resultJson, 'utf-8');
      return truncated + `\n...[truncated, ${omitted} chars omitted. Full result: ${filepath}]`;
    } catch {
      return truncated + `\n...[truncated, ${omitted} chars omitted]`;
    }
  }

  /** Cut at the last clean JSON boundary before the limit. */
  function truncateAtBoundary(text: string, limit: number): string {
    // Try: last JSON object/array close before limit
    const slice = text.slice(0, limit);
    const lastBrace = Math.max(slice.lastIndexOf('},'), slice.lastIndexOf('}]'));
    if (lastBrace > limit * 0.5) return text.slice(0, lastBrace + 1);
    // Fallback: last newline before limit
    const lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > limit * 0.5) return text.slice(0, lastNewline);
    // Last resort: raw slice
    return slice;
  }

  function cleanup(): void {
    if (dir) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      dir = null;
    }
  }

  return { spillAndTruncate, cleanup };
}

function err(name: string, error: Error): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: `Tool ${name} failed: ${error.message}` }) }],
    details: {},
  };
}

/**
 * Build all Pi AgentTools for the investigation agent.
 *
 * Returns the tools array, a ref object whose `sections` field is
 * populated when assemble_output is called, and a cleanup function
 * for the per-run spill directory.
 */
export function buildPiTools(
  state: AgentState,
  onFindingProgress?: (event: FindingProgressEvent) => void,
): { tools: AgentTool[]; assembledRef: AssembledSections; cleanup: () => void; mutex: StatefulToolMutex } {
  // Per-run spill context — each buildPiTools() call gets an isolated spill dir
  // so parallel runs (e.g. `radar compare`) don't race on cleanup.
  const spill = createSpillContext();

  /** Wrap a tool result as Pi's AgentToolResult format with per-tool size limits. */
  function ok(toolName: string, result: unknown, opts?: { details?: Record<string, unknown>; terminate?: boolean }): AgentToolResult<unknown> {
    const json = JSON.stringify(result);
    const text = spill.spillAndTruncate(toolName, json);
    return {
      content: [{ type: 'text' as const, text }],
      details: opts?.details ?? {},
      ...(opts?.terminate ? { terminate: true } : {}),
    };
  }
  const assembledRef: AssembledSections = { sections: null };
  const repoRoot = () => state.repo.localPath;

  /** Normalize args and cast for tool implementations. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const norm = (params: unknown): any => normalizePathArgs({ ...(params as Record<string, unknown>) }, repoRoot());

  /** Get stub or full description for a tool based on deferred status. */
  const desc = (name: string, full: string): string => {
    if (DEFERRED_TOOL_NAMES.has(name)) {
      return `${name}: available. Call tool_search("${name}") for full description and parameters.`;
    }
    return full;
  };

  const tools: AgentTool[] = [
    // --- Repo tools ---
    makeTool('clone_repo', 'Clone Repo',
      'Clone a GitHub repo to a local temp directory. Returns local path, default branch, and last commit info. Caches locally — repeat calls return immediately without network.',
      Type.Object({
        url: Type.String({ description: 'GitHub repo URL, e.g. https://github.com/owner/repo' }),
        branch: Type.Optional(Type.String({ description: 'Branch to clone (default: default branch)' })),
        pull: Type.Optional(Type.Boolean({ description: 'Fetch latest before returning (default: false)' })),
      }),
      async (_id, params) => {
        try {
          const a = norm(params) as { url: string; branch?: string; pull?: boolean };
          return ok('clone_repo', await cloneRepo(a));
        } catch (e) { return err('clone_repo', e as Error); }
      },
    ),

    makeTool('list_directory', 'List Directory',
      'List files and directories at a given path with configurable depth. Excludes node_modules, .next, dist, build, .git. Returns up to maxEntries entries (default 200).',
      Type.Object({
        path: Type.String({ description: 'Relative path from repo root' }),
        depth: Type.Optional(Type.Number({ description: 'Max directory depth (default 2)' })),
        includeHidden: Type.Optional(Type.Boolean({ description: 'Include hidden files/dirs' })),
        maxEntries: Type.Optional(Type.Number({ description: 'Max entries to return (default 200)' })),
      }),
      async (_id, params) => {
        try { return ok('list_directory', await listDirectory(repoRoot(), norm(params))); }
        catch (e) { return err('list_directory', e as Error); }
      },
    ),

    makeTool('read_file', 'Read File',
      'Read the contents of a file. Returns content, line count, and detected language. Supports line-range reads via startLine. Returns unchanged=true if file has not changed since last read.',
      Type.Object({
        path: Type.String({ description: 'Relative file path from repo root' }),
        maxLines: Type.Optional(Type.Number({ description: 'Max lines to return (default 500)' })),
        startLine: Type.Optional(Type.Number({ description: 'Start reading from this line number (1-based)' })),
      }),
      async (_id, params) => {
        try {
          const a = norm(params);
          const filePath = a.path as string;

          // Dedup check: skip re-read if file is unchanged
          if (state.fileReadCache && await isFileUnchanged(state, repoRoot(), filePath)) {
            state.filesRead.add(filePath);
            const cached = state.fileReadCache.get(filePath);
            return ok('read_file', {
              path: filePath,
              content: cached?.summary ?? '[file_unchanged]',
              lineCount: 0,
              language: 'text',
              unchanged: true,
            });
          }

          const result = await readFile(repoRoot(), a);
          // Track before returning: recordFinding checks filesRead inside execute()
          // and can race with afterToolCall, so tracking must happen here.
          state.filesRead.add(filePath);

          // Update dedup cache on successful read (include content for summary generation)
          if (!result.error) {
            await updateFileCache(state, repoRoot(), filePath, result.content);
          }

          return ok('read_file', result, {
            details: { lineCount: result.lineCount ?? 0, language: result.language, cached: false },
          });
        } catch (e) { return err('read_file', e as Error); }
      },
    ),

    makeTool('read_files_batch', 'Read Files Batch',
      'Read multiple files in one call. Returns partial results on errors. Skips files unchanged since last read.',
      Type.Object({
        paths: Type.Array(Type.String(), { description: 'Relative file paths from repo root' }),
        maxLinesPerFile: Type.Optional(Type.Number({ description: 'Max lines per file (default 500)' })),
      }),
      async (_id, params) => {
        try {
          const a = norm(params);
          const paths = (a.paths ?? []) as string[];

          // Dedup: split into unchanged vs needs-read
          const unchangedPaths: string[] = [];
          const toRead: string[] = [];
          if (state.fileReadCache) {
            for (const p of paths) {
              if (await isFileUnchanged(state, repoRoot(), p)) {
                unchangedPaths.push(p);
              } else {
                toRead.push(p);
              }
            }
          } else {
            toRead.push(...paths);
          }

          // Read only changed files
          const result = toRead.length > 0
            ? await readFilesBatch(repoRoot(), { ...a, paths: toRead })
            : { files: [] };

          // Add unchanged stubs with cached summaries
          const resultWithDedup = {
            ...result,
            files: [
              ...unchangedPaths.map((p) => {
                const cached = state.fileReadCache.get(p);
                return {
                  path: p,
                  content: cached?.summary ?? '[file_unchanged]',
                  lineCount: 0,
                  language: 'text' as const,
                  unchanged: true,
                };
              }),
              ...(result.files ?? []),
            ],
          };

          // Track all paths as read + update cache for newly read files.
          // Must happen in execute() (not afterToolCall) because recordFinding
          // checks filesRead inside its own execute() and can race with afterToolCall.
          for (const p of paths) state.filesRead.add(p);
          // Pass content to updateFileCache for summary generation
          const readResults = result.files ?? [];
          for (const p of toRead) {
            const fileResult = readResults.find((f) => f.path === p);
            await updateFileCache(state, repoRoot(), p, fileResult?.content);
          }

          return ok('read_files_batch', resultWithDedup);
        } catch (e) { return err('read_files_batch', e as Error); }
      },
    ),

    // --- Search tools ---
    makeTool('grep_pattern', 'Grep Pattern',
      'Search for a text pattern or regex across the repo or a subdirectory. Returns matching lines with context. Supports pagination (offset), output modes (content/files_with_matches/count), multiline matching, and mtime sorting.',
      Type.Object({
        pattern: Type.String({ description: 'Search pattern (text or regex)' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search (default: repo root)' })),
        fileGlob: Type.Optional(Type.String({ description: 'File glob filter, e.g. "*.ts,*.tsx"' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 50)' })),
        isRegex: Type.Optional(Type.Boolean({ description: 'Treat pattern as regex' })),
        offset: Type.Optional(Type.Number({ description: 'Skip first N matches for pagination (default 0)' })),
        outputMode: Type.Optional(Type.Union([
          Type.Literal('content'),
          Type.Literal('files_with_matches'),
          Type.Literal('count'),
        ], { description: 'Output format: content (default), files_with_matches, or count' })),
        multiline: Type.Optional(Type.Boolean({ description: 'Enable multiline matching across line boundaries' })),
        sortByMtime: Type.Optional(Type.Boolean({ description: 'Sort results by file modification time (most recent first)' })),
      }),
      async (_id, params) => {
        try {
          const result = await grepPattern(repoRoot(), norm(params));
          return ok('grep_pattern', result, {
            details: { matchCount: result.matches?.length ?? 0, truncated: !!result.truncated },
          });
        } catch (e) { return err('grep_pattern', e as Error); }
      },
    ),

    makeTool('find_files', 'Find Files',
      'Find files matching a glob or name pattern. Returns up to maxResults matches (default 200).',
      Type.Object({
        pattern: Type.String({ description: 'Glob pattern, e.g. "componentFactory*"' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search' })),
        type: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Filter by type' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results to return (default 200)' })),
      }),
      async (_id, params) => {
        try { return ok('find_files', await findFiles(repoRoot(), norm(params))); }
        catch (e) { return err('find_files', e as Error); }
      },
    ),

    // --- Config tools ---
    makeTool('parse_package_json', 'Parse package.json',
      'Parse package.json and return structured dependency and script information.',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to package.json directory' })),
      }),
      async (_id, params) => {
        try { return ok('parse_package_json', await parsePackageJson(repoRoot(), norm(params))); }
        catch (e) { return err('parse_package_json', e as Error); }
      },
    ),

    makeTool('parse_next_config', 'Parse Next Config',
      'Parse next.config.js/mjs/ts and extract configuration (images, redirects, env, i18n, experimental).',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to config directory' })),
      }),
      async (_id, params) => {
        try { return ok('parse_next_config', await parseNextConfig(repoRoot(), norm(params))); }
        catch (e) { return err('parse_next_config', e as Error); }
      },
    ),

    makeTool('parse_tsconfig', 'Parse tsconfig',
      'Parse tsconfig.json and return key TypeScript settings.',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to tsconfig directory' })),
      }),
      async (_id, params) => {
        try { return ok('parse_tsconfig', await parseTsconfig(repoRoot(), norm(params))); }
        catch (e) { return err('parse_tsconfig', e as Error); }
      },
    ),

    makeTool('parse_env_file', 'Parse Env File',
      'Parse .env.example or similar file. Returns variable names only, never values.',
      Type.Object({
        path: Type.String({ description: 'Relative path to the env file' }),
      }),
      async (_id, params) => {
        try { return ok('parse_env_file', await parseEnvFile(repoRoot(), norm(params))); }
        catch (e) { return err('parse_env_file', e as Error); }
      },
    ),

    makeTool('check_gitignore', 'Check Gitignore',
      'Check whether specific patterns are present in .gitignore.',
      Type.Object({
        patterns: Type.Array(Type.String(), { description: 'Patterns to check, e.g. [".env", "node_modules"]' }),
      }),
      async (_id, params) => {
        try { return ok('check_gitignore', await checkGitignore(repoRoot(), norm(params))); }
        catch (e) { return err('check_gitignore', e as Error); }
      },
    ),

    // --- Dependency tools ---
    makeTool('query_npm_versions', 'Query npm Versions',
      'Fetch latest versions for a list of packages from npm registry (uses 24h cache).',
      Type.Object({
        packages: Type.Array(Type.String(), { description: 'Package names to query' }),
      }),
      async (_id, params) => {
        try { return ok('query_npm_versions', await queryNpmVersions(norm(params))); }
        catch (e) { return err('query_npm_versions', e as Error); }
      },
    ),

    makeTool('compare_versions', 'Compare Versions',
      desc('compare_versions', 'Compare installed package versions against latest. Returns delta and severity.'),
      Type.Object({
        installed: Type.Array(
          Type.Object({ name: Type.String(), version: Type.String(), isDev: Type.Boolean() }),
          { description: 'Installed packages with versions' },
        ),
        latest: Type.Record(Type.String(), Type.Unknown(), {
          description: 'Map of package name to resolved latest version info',
        }),
      }),
      async (_id, params) => {
        try { return ok('compare_versions', compareVersions(norm(params))); }
        catch (e) { return err('compare_versions', e as Error); }
      },
    ),

    // --- Analysis tools ---
    makeTool('analyze_route_structure', 'Analyze Route Structure',
      'Scan pages/ and app/ directories to detect router type (pages/app/hybrid) and extract route map.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
      async (_id, params) => {
        try { return ok('analyze_route_structure', await analyzeRouteStructure(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_route_structure', e as Error); }
      },
    ),

    makeTool('analyze_component_directives', 'Analyze Component Directives',
      'Scan components for "use client" / "use server" directives and compute client/server ratio.',
      Type.Object({
        path: Type.String({ description: 'Relative path to components directory' }),
      }),
      async (_id, params) => {
        try { return ok('analyze_component_directives', await analyzeComponentDirectives(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_component_directives', e as Error); }
      },
    ),

    makeTool('analyze_env_usage', 'Analyze Env Usage',
      'Scan the codebase for process.env references. Classifies as public (NEXT_PUBLIC_) or server.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path to scan' }),
      }),
      async (_id, params) => {
        try { return ok('analyze_env_usage', await analyzeEnvUsage(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_env_usage', e as Error); }
      },
    ),

    makeTool('analyze_middleware', 'Analyze Middleware',
      'Parse middleware.ts/js and identify its purpose (auth, i18n, multisite, etc.), matchers, and imports.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
      async (_id, params) => {
        try { return ok('analyze_middleware', await analyzeMiddleware(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_middleware', e as Error); }
      },
    ),

    makeTool('detect_app_roots', 'Detect App Roots',
      'Scan for app entry points in a repo. Detects JS frameworks (Next.js, React, Remix, Svelte, Nuxt, Astro, Angular, Vue) via config files and deps, non-JS ecosystems (Ruby, Go, Python, Rust, PHP, .NET) via manifest files, framework versions, plugins (Prisma, Tailwind, GraphQL, Storybook), and monorepo tooling.',
      Type.Object({
        repoPath: Type.Optional(Type.String({ description: 'Subdirectory to scan (default: repo root)' })),
        maxDepth: Type.Optional(Type.Number({ description: 'Max scan depth (default 4)' })),
      }),
      async (_id, params) => {
        try { return ok('detect_app_roots', await detectAppRoots(repoRoot(), norm(params))); }
        catch (e) { return err('detect_app_roots', e as Error); }
      },
    ),

    makeTool('detect_scope_drift', 'Detect Scope Drift',
      'Cross-reference README and docs claims against actual code. Finds contradictions between what the repo documents say and what the code does (e.g., README claims TypeScript strict mode but tsconfig has strict: false).',
      Type.Object({
        repoPath: Type.Optional(Type.String({ description: 'Subdirectory to scan (default: repo root)' })),
      }),
      async (_id, params) => {
        try { return ok('detect_scope_drift', await detectScopeDrift(repoRoot(), norm(params))); }
        catch (e) { return err('detect_scope_drift', e as Error); }
      },
    ),

    makeTool('get_specialist_prompts', 'Get Specialist Prompts',
      'Given detect_app_roots output, returns targeted investigation checklists for the detected stack (Next.js, GraphQL, Prisma, Tailwind, Sitecore, Optimizely). Call this early after detect_app_roots.',
      Type.Object({
        roots: Type.Array(Type.Object({
          path: Type.String(),
          type: Type.String(),
          hasPackageJson: Type.Boolean(),
          framework: Type.Optional(Type.String()),
          frameworkVersion: Type.Optional(Type.String()),
          plugins: Type.Optional(Type.Array(Type.String())),
        })),
        isMonorepo: Type.Boolean(),
        monorepoTool: Type.Optional(Type.String()),
      }),
      async (_id, params) => {
        try { return ok('get_specialist_prompts', await getSpecialistPrompts(norm(params))); }
        catch (e) { return err('get_specialist_prompts', e as Error); }
      },
    ),

    makeTool('record_finding', 'Record Finding',
      'Record an investigation finding with category, severity, evidence, and description.',
      Type.Object({
        finding: Type.Object({
          id: Type.String({ description: 'Unique finding ID, e.g. "DEP-JSS-OUTDATED"' }),
          category: Type.Union([
            Type.Literal('stack'), Type.Literal('cms-integration'), Type.Literal('preview-editing'),
            Type.Literal('configuration'), Type.Literal('security'), Type.Literal('architecture'),
            Type.Literal('dependencies'), Type.Literal('deployment'), Type.Literal('routing'),
            Type.Literal('data-fetching'), Type.Literal('nextjs'),
            Type.Literal('performance'), Type.Literal('accessibility'), Type.Literal('forms'), Type.Literal('aria'),
            Type.Literal('auth'), Type.Literal('secrets'), Type.Literal('input-validation'),
            Type.Literal('data-exposure'), Type.Literal('testing'), Type.Literal('dx'),
            Type.Literal('media-alt'), Type.Literal('semantic-html'),
            Type.Literal('keyboard-focus'), Type.Literal('color-contrast'),
          ]),
          severity: Type.Union([
            Type.Literal('critical'), Type.Literal('high'), Type.Literal('medium'),
            Type.Literal('low'), Type.Literal('info'),
          ]),
          confidence: Type.Optional(Type.Number({
            description: 'Confidence 1-10. 9-10: verified in code. 7-8: strong pattern match. 5-6: likely, needs manual check. 3-4: speculative.',
            minimum: 1,
            maximum: 10,
          })),
          title: Type.String({ description: 'Short, factual title' }),
          description: Type.String({ description: 'What you found and why it matters' }),
          evidence: Type.Array(Type.Object({
            filePath: Type.String(),
            lineNumber: Type.Optional(Type.Number()),
            snippet: Type.Optional(Type.String({ description: 'Exact code copied from tool output. Max 5 lines.' })),
            description: Type.String(),
          })),
          tags: Type.Array(Type.String()),
          investigationNote: Type.Optional(Type.String()),
          documentationRefs: Type.Optional(Type.Array(Type.Object({
            url: Type.String(), title: Type.String(), relevance: Type.String(),
          }))),
        }),
      }),
      async (_id, params) => {
        try {
          const result = await recordFinding(state, norm(params), onFindingProgress);
          const f = (norm(params) as { finding: { id: string; severity: string; evidence: unknown[] } }).finding;
          return ok('record_finding', result, {
            details: { findingId: f.id, severity: f.severity, evidenceCount: f.evidence?.length ?? 0 },
          });
        } catch (e) { return err('record_finding', e as Error); }
      },
    ),

    // --- Web tools ---
    makeTool('web_search', 'Web Search',
      desc('web_search', 'Search the web for documentation, changelogs, migration guides, and known issues.'),
      Type.Object({
        query: Type.String({ description: 'Search query' }),
        siteFilter: Type.Optional(Type.String({ description: 'Restrict to a domain' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 5)' })),
      }),
      async (_id, params) => {
        try {
          return ok('web_search', await webSearch(norm(params)));
        } catch (e) { return err('web_search', e as Error); }
      },
    ),

    makeTool('fetch_url', 'Fetch URL',
      desc('fetch_url', 'Fetch and extract text content from a documentation URL. Converts HTML to Markdown. Includes caching, SSRF protection, and safe redirect following.'),
      Type.Object({
        url: Type.String({ description: 'URL to fetch' }),
        maxLength: Type.Optional(Type.Number({ description: 'Max characters to return (default 15000)' })),
      }),
      async (_id, params) => {
        try {
          return ok('fetch_url', await fetchUrl(norm(params)));
        } catch (e) { return err('fetch_url', e as Error); }
      },
    ),

    // --- Model switching ---
    makeTool('switch_to_fast_model', 'Switch to Fast Model',
      'Call this when you have finished investigating and are ready to record findings and assemble the brief. Switches to a faster, cheaper model for the writing phase. Only call this once — after you have gathered all the evidence you need.',
      Type.Object({}),
      async () => {
        // Actual model switch happens in runner.ts afterToolCall hook.
        // This tool just signals intent — the return confirms the switch.
        return ok('switch_to_fast_model', { status: 'acknowledged', message: 'Switching to fast model for writing phase.' });
      },
    ),

    // --- Output assembly ---
    makeTool('assemble_output', 'Assemble Output',
      'Call this when you have enough findings to produce the deliverable. Provide ALL sections with your written narrative content.',
      Type.Object({
        sections: Type.Record(Type.String(), Type.String(), {
          description: 'Map of section key to markdown content.',
        }),
      }),
      async (_id, params) => {
        if (assembledRef.sections !== null) {
          console.warn('[assemble_output] Called twice — overwriting previous sections');
        }
        const sections = (params as { sections: Record<string, string> }).sections;
        assembledRef.sections = sections;
        return ok('assemble_output', { status: 'acknowledged', message: 'Output assembly triggered.' }, {
          details: { sectionCount: Object.keys(sections).length },
          terminate: true,
        });
      },
    ),

    // --- Meta tools ---
    makeTool('tool_search', 'Tool Search',
      'Search for available tools by keyword. Returns matching tool names, full descriptions, and parameter lists. Use this to discover specialized tools like web_search, fetch_url, and compare_versions.',
      Type.Object({
        query: Type.String({ description: 'Search keyword to match against tool names and descriptions' }),
      }),
      async (_id, params) => {
        const query = ((params as Record<string, unknown>).query as string).toLowerCase();
        const matches = DEFERRED_TOOL_ENTRIES.filter((e) =>
          e.name.includes(query) || e.fullDescription.toLowerCase().includes(query),
        );
        return ok('tool_search', { matches, total: matches.length });
      },
    ),
  ];

  // Stateful tools get Pi's native per-tool executionMode: 'sequential' so Pi
  // serializes them at the framework level. The mutex stays as defense-in-depth
  // since our drain() call at run end depends on it.
  const mutex = new StatefulToolMutex();
  for (const tool of tools) {
    if (isStateful(tool.name)) {
      tool.executionMode = 'sequential';
      const original = tool.execute;
      tool.execute = (id, params, signal?, onUpdate?) =>
        mutex.serialize(() => original(id, params, signal, onUpdate));
    }
  }

  // Enforce that every tool is classified as either read-only or stateful.
  // A new tool added without updating concurrency.ts would be silently unprotected.
  for (const tool of tools) {
    if (!isReadOnly(tool.name) && !isStateful(tool.name)) {
      console.warn(`[concurrency] Tool "${tool.name}" is not classified as read-only or stateful — update concurrency.ts`);
    }
  }

  return { tools, assembledRef, cleanup: spill.cleanup, mutex };
}
