/**
 * Pi Tool Adapter — wraps existing tools in Pi's AgentTool format.
 *
 * Each tool's execute() calls executeTool(name, params, state) from the registry
 * and returns Pi's { content, details } result format. Also includes
 * the assemble_output tool, which stores sections in a closure ref
 * for post-loop retrieval.
 */

import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentState } from '../types/state.js';
import { executeTool } from './registry.js';

/** Sections captured by assemble_output, accessible after agent.prompt() returns. */
export interface AssembledSections {
  sections: Record<string, string> | null;
}

/**
 * Build Pi AgentTools from the existing tool registry.
 *
 * Returns the tools array and a ref object whose `sections` field is
 * populated when assemble_output is called.
 */
export function buildPiTools(
  state: AgentState,
): { tools: AgentTool[]; assembledRef: AssembledSections } {
  const assembledRef: AssembledSections = { sections: null };

  /** Helper: wrap a registry tool as a Pi AgentTool. */
  function wrap(
    name: string,
    label: string,
    description: string,
    parameters: AgentTool['parameters'],
  ): AgentTool {
    return {
      name,
      label,
      description,
      parameters,
      execute: async (_toolCallId, params) => {
        const result = await executeTool(name, params as Record<string, unknown>, state);
        return {
          content: [{ type: 'text' as const, text: result }],
          details: {},
        };
      },
    };
  }

  const tools: AgentTool[] = [
    // Repo tools
    wrap(
      'list_directory',
      'List Directory',
      'List files and directories at a given path with configurable depth. Excludes node_modules, .next, dist, build, .git.',
      Type.Object({
        path: Type.String({ description: 'Relative path from repo root' }),
        depth: Type.Optional(Type.Number({ description: 'Max directory depth (default 2)' })),
        includeHidden: Type.Optional(Type.Boolean({ description: 'Include hidden files/dirs' })),
      }),
    ),
    wrap(
      'read_file',
      'Read File',
      'Read the contents of a file. Returns content, line count, and detected language.',
      Type.Object({
        path: Type.String({ description: 'Relative file path from repo root' }),
        maxLines: Type.Optional(Type.Number({ description: 'Max lines to return (default 500)' })),
      }),
    ),
    wrap(
      'read_files_batch',
      'Read Files Batch',
      'Read multiple files in one call. Returns partial results on errors.',
      Type.Object({
        paths: Type.Array(Type.String(), { description: 'Relative file paths from repo root' }),
        maxLinesPerFile: Type.Optional(Type.Number({ description: 'Max lines per file (default 500)' })),
      }),
    ),

    // Search tools
    wrap(
      'grep_pattern',
      'Grep Pattern',
      'Search for a text pattern or regex across the repo or a subdirectory. Returns matching lines with context.',
      Type.Object({
        pattern: Type.String({ description: 'Search pattern (text or regex)' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search (default: repo root)' })),
        fileGlob: Type.Optional(Type.String({ description: 'File glob filter, e.g. "*.ts,*.tsx"' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 50)' })),
        isRegex: Type.Optional(Type.Boolean({ description: 'Treat pattern as regex' })),
      }),
    ),
    wrap(
      'find_files',
      'Find Files',
      'Find files matching a glob or name pattern.',
      Type.Object({
        pattern: Type.String({ description: 'Glob pattern, e.g. "componentFactory*"' }),
        path: Type.Optional(Type.String({ description: 'Subdirectory to search' })),
        type: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Filter by type' })),
      }),
    ),

    // Config tools
    wrap(
      'parse_package_json',
      'Parse package.json',
      'Parse package.json and return structured dependency and script information.',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to package.json directory' })),
      }),
    ),
    wrap(
      'parse_next_config',
      'Parse Next Config',
      'Parse next.config.js/mjs/ts and extract configuration (images, redirects, env, i18n, experimental).',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to config directory' })),
      }),
    ),
    wrap(
      'parse_tsconfig',
      'Parse tsconfig',
      'Parse tsconfig.json and return key TypeScript settings.',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative path to tsconfig directory' })),
      }),
    ),
    wrap(
      'parse_env_file',
      'Parse Env File',
      'Parse .env.example or similar file. Returns variable names only, never values.',
      Type.Object({
        path: Type.String({ description: 'Relative path to the env file' }),
      }),
    ),
    wrap(
      'check_gitignore',
      'Check Gitignore',
      'Check whether specific patterns are present in .gitignore.',
      Type.Object({
        patterns: Type.Array(Type.String(), { description: 'Patterns to check, e.g. [".env", "node_modules"]' }),
      }),
    ),

    // Dependency tools
    wrap(
      'query_npm_versions',
      'Query npm Versions',
      'Fetch latest versions for a list of packages from npm registry (uses 24h cache).',
      Type.Object({
        packages: Type.Array(Type.String(), { description: 'Package names to query' }),
      }),
    ),
    wrap(
      'compare_versions',
      'Compare Versions',
      'Compare installed package versions against latest. Returns delta and severity.',
      Type.Object({
        installed: Type.Array(
          Type.Object({
            name: Type.String(),
            version: Type.String(),
            isDev: Type.Boolean(),
          }),
          { description: 'Installed packages with versions' },
        ),
        latest: Type.Record(Type.String(), Type.Unknown(), {
          description: 'Map of package name to resolved latest version info',
        }),
      }),
    ),

    // Analysis tools
    wrap(
      'analyze_route_structure',
      'Analyze Route Structure',
      'Scan pages/ and app/ directories to detect router type (pages/app/hybrid) and extract route map.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
    ),
    wrap(
      'analyze_component_directives',
      'Analyze Component Directives',
      'Scan components for "use client" / "use server" directives and compute client/server ratio.',
      Type.Object({
        path: Type.String({ description: 'Relative path to components directory' }),
      }),
    ),
    wrap(
      'analyze_env_usage',
      'Analyze Env Usage',
      'Scan the codebase for process.env references. Classifies as public (NEXT_PUBLIC_) or server.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path to scan' }),
      }),
    ),
    wrap(
      'analyze_middleware',
      'Analyze Middleware',
      'Parse middleware.ts/js and identify its purpose (auth, i18n, multisite, etc.), matchers, and imports.',
      Type.Object({
        repoPath: Type.String({ description: 'Relative path within the repo' }),
      }),
    ),
    wrap(
      'record_finding',
      'Record Finding',
      'Record an investigation finding. Every noteworthy observation should be recorded with category, severity, evidence, and description.',
      Type.Object({
        finding: Type.Object({
          id: Type.String({ description: 'Unique finding ID, e.g. "DEP-JSS-OUTDATED"' }),
          category: Type.Union([
            Type.Literal('stack'),
            Type.Literal('cms-integration'),
            Type.Literal('preview-editing'),
            Type.Literal('configuration'),
            Type.Literal('security'),
            Type.Literal('architecture'),
            Type.Literal('dependencies'),
            Type.Literal('deployment'),
            Type.Literal('routing'),
            Type.Literal('data-fetching'),
            Type.Literal('nextjs'),
          ]),
          severity: Type.Union([
            Type.Literal('critical'),
            Type.Literal('high'),
            Type.Literal('medium'),
            Type.Literal('low'),
            Type.Literal('info'),
          ]),
          title: Type.String({ description: 'Short, factual title' }),
          description: Type.String({ description: 'What you found and why it matters' }),
          evidence: Type.Array(
            Type.Object({
              filePath: Type.String(),
              lineNumber: Type.Optional(Type.Number()),
              snippet: Type.Optional(Type.String({ description: 'Max 5 lines of relevant code' })),
              description: Type.String(),
            }),
          ),
          tags: Type.Array(Type.String()),
          investigationNote: Type.Optional(Type.String()),
          documentationRefs: Type.Optional(
            Type.Array(
              Type.Object({
                url: Type.String(),
                title: Type.String(),
                relevance: Type.String(),
              }),
            ),
          ),
        }),
      }),
    ),

    // Web tools
    wrap(
      'web_search',
      'Web Search',
      'Search the web for documentation, changelogs, migration guides, and known issues.',
      Type.Object({
        query: Type.String({ description: 'Search query' }),
        siteFilter: Type.Optional(Type.String({ description: 'Restrict to a domain' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max results (default 5)' })),
      }),
    ),
    wrap(
      'fetch_url',
      'Fetch URL',
      'Fetch and extract text content from a documentation URL. Strips HTML, returns plain text.',
      Type.Object({
        url: Type.String({ description: 'URL to fetch' }),
        maxLength: Type.Optional(Type.Number({ description: 'Max characters to return (default 15000)' })),
      }),
    ),

    // Output assembly — stores sections in closure ref for post-loop retrieval
    {
      name: 'assemble_output',
      label: 'Assemble Output',
      description:
        'Call this when you have enough findings to produce the deliverable. Provide ALL sections with your written narrative content.',
      parameters: Type.Object({
        sections: Type.Record(Type.String(), Type.String(), {
          description: 'Map of section key to markdown content.',
        }),
      }),
      execute: async (_toolCallId, params) => {
        assembledRef.sections = (params as { sections: Record<string, string> }).sections;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'acknowledged', message: 'Output assembly triggered.' }) }],
          details: {},
        };
      },
    },
  ];

  return { tools, assembledRef };
}
