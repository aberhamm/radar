/**
 * Tool input/output types for all registered tools.
 */

import type { PackageInfo, ResolvedVersionMap } from './state.js';

/** Structured error codes returned by tools for programmatic handling. */
export type ToolErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PATTERN_NO_MATCH'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'INVALID_ARGS'
  | 'INTERNAL_ERROR'
  | 'PATH_NOT_DIRECTORY'
  | 'PATH_TRAVERSAL'
  | 'BINARY_FILE';

// --- Repo tools ---

export interface ListDirectoryInput {
  path: string;
  depth?: number;
  includeHidden?: boolean;
  maxEntries?: number;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
}

export interface ListDirectoryOutput {
  entries: FileEntry[];
  error?: string;
  errorCode?: ToolErrorCode;
}

export interface ReadFileInput {
  path: string;
  startLine?: number;
  maxLines?: number;
}

export interface ReadFileOutput {
  path: string;
  content: string;
  lineCount: number;
  language: string;
  unchanged?: boolean;
  error?: string;
  errorCode?: ToolErrorCode;
}

export interface ReadFilesBatchInput {
  paths: string[];
  maxLinesPerFile?: number;
}

export interface ReadFilesBatchOutput {
  files: ReadFileOutput[];
}

// --- Search tools ---

export interface GrepPatternInput {
  pattern: string;
  path?: string;
  fileGlob?: string;
  maxResults?: number;
  offset?: number;
  isRegex?: boolean;
  outputMode?: 'content' | 'files_with_matches' | 'count';
  multiline?: boolean;
  sortByMtime?: boolean;
}

export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
  context?: string[];
}

export interface GrepPatternOutput {
  matches: GrepMatch[];
  truncated?: boolean;
  fileCounts?: Record<string, number>;
  matchedFiles?: string[];
  error?: string;
  errorCode?: ToolErrorCode;
}

export interface FindFilesInput {
  pattern: string;
  path?: string;
  type?: 'file' | 'directory';
  maxResults?: number;
}

export interface FindFilesOutput {
  matches: string[];
  truncated?: boolean;
  error?: string;
}

// --- Config parsing tools ---

export interface ParsePackageJsonInput {
  path?: string;
}

export interface ParsePackageJsonOutput {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: PackageInfo[];
  devDependencies: PackageInfo[];
  engines?: Record<string, string>;
  workspaces?: string[];
  error?: string;
}

export interface ParseNextConfigInput {
  path?: string;
}

export interface ParseNextConfigOutput {
  configPath: string;
  images?: { domains: string[]; remotePatterns: unknown[] };
  redirects: boolean;
  rewrites: boolean;
  headers: boolean;
  env: Record<string, string>;
  experimental: Record<string, unknown>;
  output?: string;
  i18n?: { locales: string[]; defaultLocale: string };
  transpilePackages?: string[];
  rawExports: string[];
  error?: string;
}

export interface ParseTsconfigInput {
  path?: string;
}

export interface ParseTsconfigOutput {
  target: string;
  module: string;
  paths?: Record<string, string[]>;
  baseUrl?: string;
  strict: boolean;
  jsx?: string;
  plugins?: unknown[];
  error?: string;
}

export interface ParseEnvFileInput {
  path: string;
}

export interface EnvVar {
  name: string;
  hasDefault: boolean;
  comment?: string;
}

export interface ParseEnvFileOutput {
  variables: EnvVar[];
  error?: string;
}

export interface CheckGitignoreInput {
  patterns: string[];
}

export interface CheckGitignoreOutput {
  results: Array<{ pattern: string; ignored: boolean }>;
  exists: boolean;
}

// --- Dependency tools ---

export interface CompareVersionsInput {
  installed: PackageInfo[];
  latest: ResolvedVersionMap;
}

export type VersionDelta =
  | 'current'
  | 'minor-behind'
  | 'major-behind-1'
  | 'major-behind-2'
  | 'major-behind-3+';

export interface VersionComparison {
  package: string;
  installed: string;
  latest: string;
  delta: VersionDelta;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
}

export interface CompareVersionsOutput {
  results: VersionComparison[];
}

// --- Analysis tools ---

export interface AnalyzeRouteStructureInput {
  repoPath: string;
}

export interface RouteEntry {
  filePath: string;
  routePath: string;
  isDynamic: boolean;
  params?: string[];
  hasGetStaticProps: boolean;
  hasGetServerSideProps: boolean;
  hasGenerateStaticParams: boolean;
  isServerComponent: boolean;
}

export interface AnalyzeRouteStructureOutput {
  routerType: 'pages' | 'app' | 'hybrid';
  routes: RouteEntry[];
  apiRoutes: RouteEntry[];
  dynamicRoutes: RouteEntry[];
  catchAllRoutes: RouteEntry[];
}

export interface AnalyzeComponentDirectivesInput {
  path: string;
}

export interface AnalyzeComponentDirectivesOutput {
  total: number;
  clientComponents: number;
  serverComponents: number;
  clientRatio: number;
  clientComponentPaths: string[];
}

export interface AnalyzeEnvUsageInput {
  repoPath: string;
}

export interface EnvUsageMatch {
  filePath: string;
  lineNumber: number;
  variable: string;
  isPublic: boolean;
}

export interface AnalyzeEnvUsageOutput {
  usages: EnvUsageMatch[];
  publicCount: number;
  serverCount: number;
}

// --- Repo tools (clone) ---

export interface CloneRepoInput {
  url: string;
  branch?: string;
  /** If true, fetch latest from remote for cached repos */
  pull?: boolean;
}

export interface CloneRepoOutput {
  localPath: string;
  defaultBranch: string;
  lastCommit: { hash: string; date: string };
  /** True if the repo was already cached locally */
  cached: boolean;
}

// --- Dependency tools (npm query) ---

export interface QueryNpmVersionsInput {
  packages: string[];
}

export interface QueryNpmVersionsOutput {
  versions: Record<string, import('./state.js').ResolvedVersion>;
  fromCache: boolean;
  cacheAge?: string;
}

// --- Analysis tools (middleware) ---

export interface AnalyzeMiddlewareInput {
  repoPath: string;
}

export interface AnalyzeMiddlewareOutput {
  exists: boolean;
  path?: string;
  matchers?: string[];
  detectedPurposes: string[];
  imports: string[];
}

// --- Knowledge tools ---

export interface LoadReferenceInput {
  key: string;
}

export interface LoadReferenceOutput {
  key: string;
  content: string;
  charCount: number;
}

export interface ListReferencesOutput {
  references: { key: string; platform: string; filename: string }[];
  total: number;
}

// --- Web tools ---

export interface WebSearchInput {
  query: string;
  siteFilter?: string;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  results: SearchResult[];
}

export interface FetchUrlInput {
  url: string;
  maxLength?: number;
  extractSelectors?: string[];
}

export interface FetchUrlOutput {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  fromCache?: boolean;
}

// --- Detect App Roots ---

export interface DetectAppRootsInput {
  repoPath?: string;  // subdirectory to scan (default: repo root)
  maxDepth?: number;  // max directory depth (default: 4)
}

export interface AppRoot {
  path: string;           // relative path from repo root
  type: 'nextjs' | 'react' | 'remix' | 'svelte' | 'nuxt' | 'astro' | 'angular' | 'vue'
      | 'ruby' | 'go' | 'python' | 'rust' | 'php' | 'dotnet' | 'node' | 'unknown';
  hasPackageJson: boolean;
  framework?: string;
  frameworkVersion?: string;  // version string from deps (e.g. "^14.2.3")
  plugins?: string[];         // detected ecosystem plugins (prisma, tailwind, etc.)
}

export interface DetectAppRootsOutput {
  roots: AppRoot[];
  isMonorepo: boolean;
  monorepoTool?: string;
}

// --- Detect Scope Drift ---

export interface DetectScopeDriftInput {
  repoPath?: string;  // subdirectory to scan (default: repo root)
}

export interface DriftClaim {
  source: string;        // e.g. "README.md", "package.json description"
  claim: string;         // extracted claim text
  verification: 'verified' | 'unverified' | 'contradicted';
  evidence?: string;     // what was actually found
  filePath?: string;     // file that contradicts or verifies
}

export interface DetectScopeDriftOutput {
  claims: DriftClaim[];
  summary: string;
}

// --- Get Specialist Prompts ---

export interface GetSpecialistPromptsInput {
  roots: AppRoot[];
  isMonorepo: boolean;
  monorepoTool?: string;
}

export interface SpecialistPrompt {
  id: string;            // e.g. "nextjs", "graphql"
  name: string;          // display name
  relevance: 'high' | 'medium' | 'low';
  checklist: string;     // markdown content from the specialist file
}

export interface GetSpecialistPromptsOutput {
  specialists: SpecialistPrompt[];
  summary: string;
}
