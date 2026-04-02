/**
 * Pi Tool Registry — all tools as Pi AgentTool[] with TypeBox schemas.
 *
 * Each tool's execute() calls the implementation directly, normalizes
 * LLM path arguments, tracks state side effects, and returns Pi's
 * { content, details } result format.
 *
 * Also includes assemble_output, which stores sections in a closure
 * ref for post-loop retrieval by the runner.
 */

import { Type } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { AgentState } from '../types/state.js';

// Tool implementations
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

/** Sections captured by assemble_output, accessible after agent.prompt() returns. */
export interface AssembledSections {
  sections: Record<string, string> | null;
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
 * Max characters for a single tool result. Prevents conversation history bloat
 * from large grep/file results. 4000 chars ~= 1000 tokens.
 */
const MAX_RESULT_CHARS = 4000;

/** Truncate a string to a max length, appending a notice if truncated. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n...[truncated, ' + (text.length - max) + ' chars omitted]';
}

/** Wrap a tool result as Pi's AgentToolResult format. */
function ok(result: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: truncate(JSON.stringify(result), MAX_RESULT_CHARS) }],
    details: {},
  };
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
 * Returns the tools array and a ref object whose `sections` field is
 * populated when assemble_output is called.
 */
export function buildPiTools(
  state: AgentState,
): { tools: AgentTool[]; assembledRef: AssembledSections } {
  const assembledRef: AssembledSections = { sections: null };
  const repoRoot = () => state.repo.localPath;

  /** Normalize args and cast for tool implementations. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const norm = (params: unknown): any => normalizePathArgs({ ...(params as Record<string, unknown>) }, repoRoot());

  const tools: AgentTool[] = [
    // --- Repo tools ---
    {
      name: 'list_directory',
      label: 'List Directory',
      description: 'List files and directories at a given path with configurable depth. Excludes node_modules, .next, dist, build, .git.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative path from repo root' }),
        depth: Type.Optional(Type.Number({ description: 'Max directory depth (default 2)' })),
        includeHidden: Type.Optional(Type.Boolean({ description: 'Include hidden files/dirs' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await listDirectory(repoRoot(), norm(params))); }
        catch (e) { return err('list_directory', e as Error); }
      },
    },
    {
      name: 'read_file',
      label: 'Read File',
      description: 'Read the contents of a file. Returns content, line count, and detected language.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative file path from repo root' }),
        maxLines: Type.Optional(Type.Number({ description: 'Max lines to return (default 500)' })),
      }),
      execute: async (_id, params) => {
        try {
          const a = norm(params);
          const result = await readFile(repoRoot(), a);
          state.filesRead.add(a.path);
          return ok(result);
        } catch (e) { return err('read_file', e as Error); }
      },
    },
    {
      name: 'read_files_batch',
      label: 'Read Files Batch',
      description: 'Read multiple files in one call. Returns partial results on errors.',
      parameters: Type.Object({
        paths: Type.Array(Type.String(), { description: 'Relative file paths from repo root' }),
        maxLinesPerFile: Type.Optional(Type.Number({ description: 'Max lines per file (default 500)' })),
      }),
      execute: async (_id, params) => {
        try {
          const a = norm(params);
          const result = await readFilesBatch(repoRoot(), a);
          for (const p of a.paths ?? []) state.filesRead.add(p);
          return ok(result);
        } catch (e) { return err('read_files_batch', e as Error); }
      },
    },

    // --- Search tools ---
    {
      name: 'grep_pattern',
      label: 'Grep Pattern',
      description: 'Search for a text pattern or regex across the repo or a subdirectory. Returns matching lines with context.',
      parameters: Type.Object({
        pattern: Type.String({ description: 'Search pattern (text or regex)' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search (default: repo root)' })),
        fileGlob: Type.Optional(Type.String({ description: 'File glob filter, e.g. "*.ts,*.tsx"' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 50)' })),
        isRegex: Type.Optional(Type.Boolean({ description: 'Treat pattern as regex' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await grepPattern(repoRoot(), norm(params))); }
        catch (e) { return err('grep_pattern', e as Error); }
      },
    },
    {
      name: 'find_files',
      label: 'Find Files',
      description: 'Find files matching a glob or name pattern.',
      parameters: Type.Object({
        pattern: Type.String({ description: 'Glob pattern, e.g. "componentFactory*"' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search' })),
        type: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Filter by type' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await findFiles(repoRoot(), norm(params))); }
        catch (e) { return err('find_files', e as Error); }
      },
    },

    // --- Config tools ---
    {
      name: 'parse_package_json',
      label: 'Parse package.json',
      description: 'Parse package.json and return structured dependency and script information.',
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to package.json directory' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await parsePackageJson(repoRoot(), norm(params))); }
        catch (e) { return err('parse_package_json', e as Error); }
      },
    },
    {
      name: 'parse_next_config',
      label: 'Parse Next Config',
      description: 'Parse next.config.js/mjs/ts and extract configuration (images, redirects, env, i18n, experimental).',
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to config directory' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await parseNextConfig(repoRoot(), norm(params))); }
        catch (e) { return err('parse_next_config', e as Error); }
      },
    },
    {
      name: 'parse_tsconfig',
      label: 'Parse tsconfig',
      description: 'Parse tsconfig.json and return key TypeScript settings.',
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to tsconfig directory' })),
      }),
      execute: async (_id, params) => {
        try { return ok(await parseTsconfig(repoRoot(), norm(params))); }
        catch (e) { return err('parse_tsconfig', e as Error); }
      },
    },
    {
      name: 'parse_env_file',
      label: 'Parse Env File',
      description: 'Parse .env.example or similar file. Returns variable names only, never values.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative path to the env file' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await parseEnvFile(repoRoot(), norm(params))); }
        catch (e) { return err('parse_env_file', e as Error); }
      },
    },
    {
      name: 'check_gitignore',
      label: 'Check Gitignore',
      description: 'Check whether specific patterns are present in .gitignore.',
      parameters: Type.Object({
        patterns: Type.Array(Type.String(), { description: 'Patterns to check, e.g. [".env", "node_modules"]' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await checkGitignore(repoRoot(), norm(params))); }
        catch (e) { return err('check_gitignore', e as Error); }
      },
    },

    // --- Dependency tools ---
    {
      name: 'query_npm_versions',
      label: 'Query npm Versions',
      description: 'Fetch latest versions for a list of packages from npm registry (uses 24h cache).',
      parameters: Type.Object({
        packages: Type.Array(Type.String(), { description: 'Package names to query' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await queryNpmVersions(norm(params))); }
        catch (e) { return err('query_npm_versions', e as Error); }
      },
    },
    {
      name: 'compare_versions',
      label: 'Compare Versions',
      description: 'Compare installed package versions against latest. Returns delta and severity.',
      parameters: Type.Object({
        installed: Type.Array(
          Type.Object({ name: Type.String(), version: Type.String(), isDev: Type.Boolean() }),
          { description: 'Installed packages with versions' },
        ),
        latest: Type.Record(Type.String(), Type.Unknown(), {
          description: 'Map of package name to resolved latest version info',
        }),
      }),
      execute: async (_id, params) => {
        try { return ok(compareVersions(norm(params))); }
        catch (e) { return err('compare_versions', e as Error); }
      },
    },

    // --- Analysis tools ---
    {
      name: 'analyze_route_structure',
      label: 'Analyze Route Structure',
      description: 'Scan pages/ and app/ directories to detect router type (pages/app/hybrid) and extract route map.',
      parameters: Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await analyzeRouteStructure(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_route_structure', e as Error); }
      },
    },
    {
      name: 'analyze_component_directives',
      label: 'Analyze Component Directives',
      description: 'Scan components for "use client" / "use server" directives and compute client/server ratio.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative path to components directory' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await analyzeComponentDirectives(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_component_directives', e as Error); }
      },
    },
    {
      name: 'analyze_env_usage',
      label: 'Analyze Env Usage',
      description: 'Scan the codebase for process.env references. Classifies as public (NEXT_PUBLIC_) or server.',
      parameters: Type.Object({
        repoPath: Type.String({ description: 'Relative path to scan' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await analyzeEnvUsage(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_env_usage', e as Error); }
      },
    },
    {
      name: 'analyze_middleware',
      label: 'Analyze Middleware',
      description: 'Parse middleware.ts/js and identify its purpose (auth, i18n, multisite, etc.), matchers, and imports.',
      parameters: Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
      execute: async (_id, params) => {
        try { return ok(await analyzeMiddleware(repoRoot(), norm(params))); }
        catch (e) { return err('analyze_middleware', e as Error); }
      },
    },
    {
      name: 'record_finding',
      label: 'Record Finding',
      description: 'Record an investigation finding with category, severity, evidence, and description.',
      parameters: Type.Object({
        finding: Type.Object({
          id: Type.String({ description: 'Unique finding ID, e.g. "DEP-JSS-OUTDATED"' }),
          category: Type.Union([
            Type.Literal('stack'), Type.Literal('cms-integration'), Type.Literal('preview-editing'),
            Type.Literal('configuration'), Type.Literal('security'), Type.Literal('architecture'),
            Type.Literal('dependencies'), Type.Literal('deployment'), Type.Literal('routing'),
            Type.Literal('data-fetching'), Type.Literal('nextjs'),
          ]),
          severity: Type.Union([
            Type.Literal('critical'), Type.Literal('high'), Type.Literal('medium'),
            Type.Literal('low'), Type.Literal('info'),
          ]),
          title: Type.String({ description: 'Short, factual title' }),
          description: Type.String({ description: 'What you found and why it matters' }),
          evidence: Type.Array(Type.Object({
            filePath: Type.String(),
            lineNumber: Type.Optional(Type.Number()),
            snippet: Type.String({ description: 'REQUIRED: Exact code copied from tool output. Max 5 lines.' }),
            description: Type.String(),
          })),
          tags: Type.Array(Type.String()),
          investigationNote: Type.Optional(Type.String()),
          documentationRefs: Type.Optional(Type.Array(Type.Object({
            url: Type.String(), title: Type.String(), relevance: Type.String(),
          }))),
        }),
      }),
      execute: async (_id, params) => {
        try { return ok(await recordFinding(state, norm(params))); }
        catch (e) { return err('record_finding', e as Error); }
      },
    },

    // --- Web tools ---
    {
      name: 'web_search',
      label: 'Web Search',
      description: 'Search the web for documentation, changelogs, migration guides, and known issues.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query' }),
        siteFilter: Type.Optional(Type.String({ description: 'Restrict to a domain' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 5)' })),
      }),
      execute: async (_id, params) => {
        try {
          state.webSearchCount++;
          return ok(await webSearch(norm(params)));
        } catch (e) { return err('web_search', e as Error); }
      },
    },
    {
      name: 'fetch_url',
      label: 'Fetch URL',
      description: 'Fetch and extract text content from a documentation URL. Strips HTML, returns plain text.',
      parameters: Type.Object({
        url: Type.String({ description: 'URL to fetch' }),
        maxLength: Type.Optional(Type.Number({ description: 'Max characters to return (default 15000)' })),
      }),
      execute: async (_id, params) => {
        try {
          state.urlFetchCount++;
          return ok(await fetchUrl(norm(params)));
        } catch (e) { return err('fetch_url', e as Error); }
      },
    },

    // --- Model switching ---
    {
      name: 'switch_to_fast_model',
      label: 'Switch to Fast Model',
      description: 'Call this when you have finished investigating and are ready to record findings and assemble the brief. Switches to a faster, cheaper model for the writing phase. Only call this once — after you have gathered all the evidence you need.',
      parameters: Type.Object({}),
      execute: async () => {
        // Actual model switch happens in runner.ts afterToolCall hook.
        // This tool just signals intent — the return confirms the switch.
        return ok({ status: 'acknowledged', message: 'Switching to fast model for writing phase.' });
      },
    },

    // --- Output assembly ---
    {
      name: 'assemble_output',
      label: 'Assemble Output',
      description: 'Call this when you have enough findings to produce the deliverable. Provide ALL sections with your written narrative content.',
      parameters: Type.Object({
        sections: Type.Record(Type.String(), Type.String(), {
          description: 'Map of section key to markdown content.',
        }),
      }),
      execute: async (_id, params) => {
        assembledRef.sections = (params as { sections: Record<string, string> }).sections;
        return ok({ status: 'acknowledged', message: 'Output assembly triggered.' });
      },
    },
  ];

  return { tools, assembledRef };
}
