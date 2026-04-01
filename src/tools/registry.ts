import type { ToolDefinition, ToolCall } from '../types/provider.js';
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
 * The repoRoot is bound at registration time.
 */
export type ToolExecutor = (
  toolCall: ToolCall,
  state: AgentState,
) => Promise<string>;

/**
 * Build the list of LLM tool definitions (JSON Schema format).
 */
export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFS;
}

/**
 * Normalize path arguments from the LLM.
 * The LLM sometimes passes absolute paths like "/" or "/src" instead of
 * relative paths. Strip leading slashes so path.resolve(repoRoot, p)
 * stays within the repo.
 */
function normalizePathArgs(args: Record<string, unknown>): Record<string, unknown> {
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
  toolCall: ToolCall,
  state: AgentState,
): Promise<string> {
  const name = toolCall.function.name;
  const args = normalizePathArgs(JSON.parse(toolCall.function.arguments));
  const repoRoot = state.repo.localPath;

  try {
    let result: unknown;

    switch (name) {
      // Repo tools
      case 'list_directory':
        result = await listDirectory(repoRoot, args);
        break;
      case 'read_file':
        result = await readFile(repoRoot, args);
        state.filesRead.add(args.path);
        break;
      case 'read_files_batch':
        result = await readFilesBatch(repoRoot, args);
        for (const p of args.paths ?? []) state.filesRead.add(p);
        break;

      // Search tools
      case 'grep_pattern':
        result = await grepPattern(repoRoot, args);
        break;
      case 'find_files':
        result = await findFiles(repoRoot, args);
        break;

      // Config tools
      case 'parse_package_json':
        result = await parsePackageJson(repoRoot, args);
        break;
      case 'parse_next_config':
        result = await parseNextConfig(repoRoot, args);
        break;
      case 'parse_tsconfig':
        result = await parseTsconfig(repoRoot, args);
        break;
      case 'parse_env_file':
        result = await parseEnvFile(repoRoot, args);
        break;
      case 'check_gitignore':
        result = await checkGitignore(repoRoot, args);
        break;

      // Dependency tools
      case 'compare_versions':
        result = compareVersions(args);
        break;
      case 'query_npm_versions':
        result = await queryNpmVersions(args);
        break;

      // Analysis tools
      case 'analyze_route_structure':
        result = await analyzeRouteStructure(repoRoot, args);
        break;
      case 'analyze_component_directives':
        result = await analyzeComponentDirectives(repoRoot, args);
        break;
      case 'analyze_env_usage':
        result = await analyzeEnvUsage(repoRoot, args);
        break;
      case 'analyze_middleware':
        result = await analyzeMiddleware(repoRoot, args);
        break;
      case 'record_finding':
        result = recordFinding(state, args);
        break;

      // Web tools
      case 'web_search':
        state.webSearchCount++;
        result = await webSearch(args);
        break;
      case 'fetch_url':
        state.urlFetchCount++;
        result = await fetchUrl(args);
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

/**
 * Tool definitions in OpenAI function-calling format.
 */
const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List files and directories at a given path with configurable depth. Excludes node_modules, .next, dist, build, .git.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from repo root' },
          depth: { type: 'number', description: 'Max directory depth (default 2)' },
          includeHidden: { type: 'boolean', description: 'Include hidden files/dirs' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns content, line count, and detected language.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path from repo root' },
          maxLines: { type: 'number', description: 'Max lines to return (default 500)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_files_batch',
      description: 'Read multiple files in one call. Returns partial results on errors.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative file paths from repo root',
          },
          maxLinesPerFile: { type: 'number', description: 'Max lines per file (default 500)' },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_pattern',
      description:
        'Search for a text pattern or regex across the repo or a subdirectory. Returns matching lines with context.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (text or regex)' },
          path: { type: 'string', description: 'Subdirectory to search (default: repo root)' },
          fileGlob: { type: 'string', description: 'File glob filter, e.g. "*.ts,*.tsx"' },
          maxResults: { type: 'number', description: 'Max results (default 50)' },
          isRegex: { type: 'boolean', description: 'Treat pattern as regex' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files matching a glob or name pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "componentFactory*"' },
          path: { type: 'string', description: 'Subdirectory to search' },
          type: { type: 'string', enum: ['file', 'directory'], description: 'Filter by type' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_package_json',
      description: 'Parse package.json and return structured dependency and script information.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to package.json directory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_next_config',
      description:
        'Parse next.config.js/mjs/ts and extract configuration (images, redirects, env, i18n, experimental).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to config directory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_tsconfig',
      description: 'Parse tsconfig.json and return key TypeScript settings.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to tsconfig directory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_env_file',
      description: 'Parse .env.example or similar file. Returns variable names only, never values.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the env file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_gitignore',
      description: 'Check whether specific patterns are present in .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Patterns to check, e.g. [".env", "node_modules"]',
          },
        },
        required: ['patterns'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_npm_versions',
      description:
        'Fetch latest versions for a list of packages from npm registry (uses 24h cache).',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Package names to query',
          },
        },
        required: ['packages'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_versions',
      description:
        'Compare installed package versions against latest. Returns delta (current, minor-behind, major-behind) and severity.',
      parameters: {
        type: 'object',
        properties: {
          installed: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                isDev: { type: 'boolean' },
              },
              required: ['name', 'version', 'isDev'],
            },
            description: 'Installed packages with versions',
          },
          latest: {
            type: 'object',
            description: 'Map of package name to resolved latest version info',
          },
        },
        required: ['installed', 'latest'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_route_structure',
      description:
        'Scan pages/ and app/ directories to detect router type (pages/app/hybrid) and extract route map.',
      parameters: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Relative path within the repo' },
        },
        required: ['repoPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_component_directives',
      description:
        'Scan components for "use client" / "use server" directives and compute client/server ratio.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to components directory' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_env_usage',
      description:
        'Scan the codebase for process.env references. Classifies as public (NEXT_PUBLIC_) or server.',
      parameters: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Relative path to scan' },
        },
        required: ['repoPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_middleware',
      description:
        'Parse middleware.ts/js and identify its purpose (auth, i18n, multisite, etc.), matchers, and imports.',
      parameters: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Relative path within the repo' },
        },
        required: ['repoPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_finding',
      description:
        'Record an investigation finding. Every noteworthy observation should be recorded with category, severity, evidence, and description.',
      parameters: {
        type: 'object',
        properties: {
          finding: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique finding ID, e.g. "DEP-JSS-OUTDATED"' },
              category: {
                type: 'string',
                enum: [
                  'stack',
                  'cms-integration',
                  'preview-editing',
                  'configuration',
                  'security',
                  'architecture',
                  'dependencies',
                  'deployment',
                  'routing',
                  'data-fetching',
                  'nextjs',
                ],
              },
              severity: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'info'],
              },
              title: { type: 'string', description: 'Short, factual title' },
              description: { type: 'string', description: 'What you found and why it matters' },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    filePath: { type: 'string' },
                    lineNumber: { type: 'number' },
                    snippet: { type: 'string', description: 'Max 5 lines of relevant code' },
                    description: { type: 'string' },
                  },
                  required: ['filePath', 'description'],
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              investigationNote: { type: 'string' },
              documentationRefs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    title: { type: 'string' },
                    relevance: { type: 'string' },
                  },
                  required: ['url', 'title', 'relevance'],
                },
              },
            },
            required: ['id', 'category', 'severity', 'title', 'description', 'evidence', 'tags'],
          },
        },
        required: ['finding'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for documentation, changelogs, migration guides, and known issues. Prefer approved documentation domains.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          siteFilter: { type: 'string', description: 'Restrict to a domain, e.g. "doc.sitecore.com"' },
          maxResults: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch and extract text content from a documentation URL. Strips HTML, returns plain text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxLength: { type: 'number', description: 'Max characters to return (default 15000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assemble_output',
      description:
        'Call this when you have enough findings to produce the deliverable. Provide ALL sections with your written narrative content. Each section value should be complete markdown text including a ## heading.',
      parameters: {
        type: 'object',
        properties: {
          sections: {
            type: 'object',
            description: 'Map of section key to markdown content. Required keys for onboarding: project_overview, stack_and_architecture, key_files, cms_integration, preview_editing, configuration_environment, local_setup, scorecard, top_risks, first_week_reading, client_questions, next_actions. Each value must be a full markdown section with ## heading and substantive content.',
            properties: {
              project_overview: { type: 'string', description: '## Project Overview — what this project is, who it serves, high-level architecture' },
              stack_and_architecture: { type: 'string', description: '## Stack & Architecture — framework, language, key libraries, architectural patterns' },
              key_files: { type: 'string', description: '## Key Files — markdown table of important files with | Path | Purpose | Why It Matters |' },
              cms_integration: { type: 'string', description: '## CMS Integration — how content is fetched, SDK patterns, content modeling' },
              preview_editing: { type: 'string', description: '## Preview & Editing — how preview/draft mode works, editing integration' },
              configuration_environment: { type: 'string', description: '## Configuration & Environment — required env vars, config files, setup requirements' },
              local_setup: { type: 'string', description: '## Local Development Setup — step-by-step instructions to get running locally' },
              scorecard: { type: 'string', description: '## Architecture Scorecard — summary of scores and key observations per category' },
              top_risks: { type: 'string', description: '## Top Risks — prioritized list of issues that need attention' },
              first_week_reading: { type: 'string', description: '## First Week Reading List — ordered list of files/docs to read first' },
              client_questions: { type: 'string', description: '## Questions for the Client — unanswered questions that need client input' },
              next_actions: { type: 'string', description: '## Suggested Next Actions — prioritized recommendations' },
            },
          },
        },
        required: ['sections'],
      },
    },
  },
];
