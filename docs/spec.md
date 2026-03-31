Implementation Spec: repo-audit-delivery-agent (v2 — Agentic Architecture) Document purpose This spec is intended for a coding agent tasked with building the system. It describes an agentic repo analysis tool where the agent reasons about what to investigate, selects tools dynamically, and builds up findings through iterative exploration — not a fixed pipeline.

---

1. System overview What this is An agentic consulting tool that investigates headless CMS codebases (Sitecore XM Cloud/JSS + Next.js, Optimizely SaaS CMS + Next.js) and produces structured, scored, consulting-grade deliverables. The agent is given a goal (e.g. "produce an onboarding brief"), a set of tools (file reading, pattern matching, config parsing, npm queries), and a set of consulting rules. It decides what to investigate, in what order, and how deep to go based on what it discovers. What this is not A fixed pipeline that runs every check in order A generic code assistant or chatbot A linter or static analysis tool with an LLM wrapper Core design principle Tools are deterministic. Orchestration is agentic. Rules are human-authored. Outputs are structured. Tools return facts: file contents, parsed configs, grep results, npm versions. They never hallucinate. Orchestration is the agent's job: it reads tool results, reasons about what they mean, decides what to investigate next, and knows when it has enough information to produce its deliverable. Rules are consulting-specific instructions written in plain English by senior consultants. They shape the agent's priorities, investigation depth, and quality standards without requiring code changes. Outputs follow structured templates. The agent populates them with findings and narrative, but the structure is fixed per deliverable type. Why this architecture demonstrates Pi Pi is an agent runtime, not a script runner. This architecture uses Pi for what it's designed to do: Tool registration: deterministic tools are registered as Pi tools the agent can invoke Agent loop: the observe → reason → act cycle is Pi's core execution model Dynamic planning: the agent generates an investigation plan per repo, not a hardcoded sequence System instructions: consulting rules are injected as Pi system prompts, editable without code changes Multi-step reasoning: intermediate findings shape subsequent investigation, which requires Pi's state management across tool calls Goal-driven execution: the same agent and tools serve different goals (onboarding, audit, migration) based on the goal prompt, not separate codepaths A fixed pipeline would not need Pi. This does.

---

2. Architecture Agent loop

```
┌──────────────────────────────────────────────────────────┐
│  Goal Prompt                                             │
│  "Produce an onboarding brief for this Sitecore repo"    │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  Agent (Pi runtime)                                      │
│                                                          │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐              │
│  │ Observe │───▶│ Reason  │───▶│  Act    │──┐           │
│  │         │    │         │    │         │  │           │
│  │ Read    │    │ What do │    │ Call a  │  │           │
│  │ tool    │    │ I know? │    │ tool or │  │           │
│  │ results │    │ What's  │    │ record  │  │           │
│  │         │    │ missing?│    │ finding │  │           │
│  └─────────┘    └─────────┘    └─────────┘  │           │
│       ▲                                      │           │
│       └──────────────────────────────────────┘           │
│                                                          │
│  Continues until: goal is satisfied or tool budget spent │
├──────────────────────────────────────────────────────────┤
│  System instructions (consulting rules)                  │
│  Reference knowledge base (static files)                 │
│  Registered tools (deterministic)                        │
│  Working state (findings, file cache, investigation log) │
├──────────────────────────────────────────────────────────┤
│  Output assembler                                        │
│  (scorecard + narrative from accumulated findings)       │
└──────────────────────────────────────────────────────────┘
```

Component responsibilities 2.1 Agent Runtime (Pi) The agent receives: a goal prompt defining what deliverable to produce system instructions containing consulting rules and investigation guidance reference knowledge as static context (platform-specific best practices) access to registered tools The agent maintains working state across tool calls: accumulated findings files already read (avoid re-reading) current understanding of the repo (stack, patterns, risks) remaining investigation priorities The agent terminates when: it has enough findings to populate the requested deliverable it has exhausted its tool call budget (configurable, default 50 tool calls) it determines additional investigation would not change the output 2.2 Tool Layer Tools are deterministic functions registered with Pi. They accept structured inputs and return structured outputs. They do not call an LLM. They do not reason. They return facts. See section 4 for the full tool catalog. 2.3 Consulting Rules (System Instructions) Plain English instructions that shape agent behavior. These are loaded from markdown files and injected into the Pi system prompt. Senior consultants can edit them without touching code. See section 5 for the rule set. 2.4 Reference Knowledge Base Static markdown files that provide platform-specific context the agent can draw on during reasoning. These ship with the tool and are updated periodically by the team. See section 6 for the knowledge base structure. 2.5 Output Assembler After the investigation loop completes, the agent produces its deliverable by populating a structured output template with its accumulated findings and narrative. The assembler enforces the output schema — every required section must be present, every finding must have evidence. See section 7 for output schemas.

---

3. Data models 3.1 Finding The core unit of agent output during investigation. Every time the agent identifies something noteworthy, it records a finding.

```typescript
interface Finding {
  id: string; // agent-assigned, e.g. "PREVIEW-CONFIG-MISSING"
  category: FindingCategory;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string; // short, factual
  description: string; // agent's explanation of what it found and why it matters
  evidence: Evidence[];
  tags: string[];
  investigationNote?: string; // agent's reasoning about how this connects to other findings
  documentationRefs?: DocRef[]; // external docs that informed this finding
}

interface DocRef {
  url: string;
  title: string;
  relevance: string; // why this doc is relevant to the finding
}

type FindingCategory =
  | 'stack'
  | 'cms-integration'
  | 'preview-editing'
  | 'configuration'
  | 'security'
  | 'architecture'
  | 'dependencies'
  | 'deployment'
  | 'routing'
  | 'data-fetching'
  | 'nextjs';

interface Evidence {
  filePath: string;
  lineNumber?: number;
  snippet?: string; // max 5 lines of relevant code
  description: string;
}
```

3.2 AgentState Working state the agent maintains across tool calls.

```typescript
interface AgentState {
  goal: GoalType;
  repo: {
    source: 'github' | 'local';
    url?: string;
    localPath: string;
    name: string;
  };
  resolvedVersions: ResolvedVersionMap;
  stackProfile?: StackProfile; // built incrementally by agent
  findings: Finding[];
  filesRead: Set<string>; // paths already read, avoid re-reading
  toolCallCount: number;
  toolCallBudget: number; // default 50
  webSearchCount: number;
  webSearchBudget: number; // default 5, higher for migration
  urlFetchCount: number;
  urlFetchBudget: number; // default 3, higher for migration
  docTokensUsed: number;
  docTokenBudget: number; // default 20000
  fetchedDocs: FetchedDoc[]; // documentation fetched during investigation
  investigationLog: InvestigationEntry[];
}

type GoalType = 'onboarding' | 'audit' | 'migration' | 'component-map';

interface InvestigationEntry {
  step: number;
  action: string; // what tool was called
  reasoning: string; // why the agent chose this action
  result: string; // summary of what was learned
}

interface FetchedDoc {
  url: string;
  title: string;
  fetchedAt: string;
  tokenCount: number;
  usedInFindings: string[]; // finding IDs that reference this doc
}
```

3.3 StackProfile Built incrementally by the agent as it discovers stack information. Not populated in one pass.

```typescript
interface StackProfile {
  projectType: 'sitecore' | 'optimizely' | 'unknown';
  projectTypeConfidence: 'high' | 'medium' | 'low';
  framework: {
    name: string;
    version: string;
    routerType: 'pages' | 'app' | 'hybrid' | 'unknown';
  };
  cms: {
    platform: string;
    sdkPackages: PackageInfo[];
    integrationStyle: string;
  };
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  language: 'typescript' | 'javascript' | 'mixed';
  deploymentIndicators: string[];
  monorepo: boolean;
  monorepoTool?: string;
}

interface PackageInfo {
  name: string;
  version: string;
  isDev: boolean;
}
```

3.4 ResolvedVersionMap Fetched from npm before the agent loop begins. This is the one deterministic pre-step.

```typescript
interface ResolvedVersion {
  package: string;
  latest: string;
  latestMajor: number;
  fetchedAt: string;
}

type ResolvedVersionMap = Record<string, ResolvedVersion>;
```

---

4. Tool catalog Every tool is a registered Pi tool with typed inputs and outputs. The agent chooses which tools to call and in what order. Design principles for tools Tools return data, not judgments. "This file contains X" not "This file has a problem." Tools are stateless. They don't know what the agent has already found. Tools are fast. Each call should complete in under 2 seconds. Tools redact secrets. Any value that looks like a key/token/password is replaced with `***`. Tools handle errors gracefully. File not found → return empty result, not throw. 4.1 Repo tools These tools provide basic access to the repository. `clone_repo` Clone a GitHub repo to a local temp directory.

```typescript
// Input
{ url: string; branch?: string }

// Output
{ localPath: string; defaultBranch: string; lastCommit: { hash: string; date: string } }
```

`list_directory` List files and directories at a given path, with configurable depth.

```typescript
// Input
{ path: string; depth?: number; includeHidden?: boolean }

// Output
{ entries: FileEntry[] }
// FileEntry: { name: string; type: "file" | "directory"; path: string; size?: number }
```

Filters: automatically excludes `node_modules`, `.next`, `dist`, `build`, `.git`. `read_file` Read the contents of a file. Returns content and basic metadata.

```typescript
// Input
{ path: string; maxLines?: number }

// Output
{ path: string; content: string; lineCount: number; language: string }
```

If `maxLines` is set, returns the first N lines with a truncation notice. Default: full file up to 500 lines. Files over 500 lines are truncated with a note. `read_files_batch` Read multiple files in one call. Useful when the agent already knows which files it needs.

```typescript
// Input
{ paths: string[]; maxLinesPerFile?: number }

// Output
{ files: Array<{ path: string; content: string; lineCount: number; language: string; error?: string }> }
```

4.2 Search tools `grep_pattern` Search for a text pattern or regex across the repo or a subdirectory.

```typescript
// Input
{ pattern: string; path?: string; fileGlob?: string; maxResults?: number; isRegex?: boolean }

// Output
{ matches: GrepMatch[] }
// GrepMatch: { filePath: string; lineNumber: number; line: string; context?: string[] }
```

Default max results: 50. Context: 1 line above and below. `find_files` Find files matching a glob or name pattern.

```typescript
// Input
{ pattern: string; path?: string; type?: "file" | "directory" }

// Output
{ matches: string[] }
```

4.3 Config parsing tools These tools parse specific config files and return structured data. The agent doesn't have to regex through raw file content for common patterns. `parse_package_json` Parse `package.json` and return structured dependency and script information.

```typescript
// Input
{ path?: string }  // defaults to repo root

// Output
{
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: PackageInfo[];
  devDependencies: PackageInfo[];
  engines?: Record<string, string>;
  workspaces?: string[];
}
```

`parse_next_config` Parse `next.config.js` / `next.config.mjs` / `next.config.ts` and extract configuration.

```typescript
// Input
{ path?: string }

// Output
{
  configPath: string;
  images?: { domains: string[]; remotePatterns: any[] };
  redirects: boolean;
  rewrites: boolean;
  headers: boolean;
  env: Record<string, string>;
  experimental: Record<string, any>;
  output?: string;              // "standalone" | "export" | undefined
  i18n?: { locales: string[]; defaultLocale: string };
  transpilePackages?: string[];
  rawExports: string[];         // list of named exports found
}
```

Implementation note: This tool runs the config through a limited static analysis (AST or regex extraction), not dynamic execution. It extracts what it can and reports `rawExports` for anything it can't fully parse. `parse_tsconfig` Parse `tsconfig.json` and return key settings.

```typescript
// Input
{ path?: string }

// Output
{
  target: string;
  module: string;
  paths?: Record<string, string[]>;
  baseUrl?: string;
  strict: boolean;
  jsx?: string;
  plugins?: any[];
}
```

`parse_env_file` Parse `.env.example`, `.env.local.example`, or similar files. Returns variable names only — never values.

```typescript
// Input
{ path: string }

// Output
{
  variables: EnvVar[];
}
// EnvVar: { name: string; hasDefault: boolean; comment?: string }
```

`check_gitignore` Check whether specific patterns are present in `.gitignore`.

```typescript
// Input
{ patterns: string[] }  // e.g. [".env", ".env.local", "node_modules"]

// Output
{ results: Array<{ pattern: string; ignored: boolean }> }
```

4.4 Dependency tools `query_npm_versions` Fetch latest versions for a list of packages from npm registry (or return from cache).

```typescript
// Input
{ packages: string[] }

// Output
{ versions: ResolvedVersionMap; fromCache: boolean; cacheAge?: string }
```

Caching: results cached to `.repo-audit-delivery-agent/version-cache.json` with 24-hour TTL. Falls back to stale cache on network failure. `compare_versions` Compare installed package versions against resolved latest versions.

```typescript
// Input
{ installed: PackageInfo[]; latest: ResolvedVersionMap }

// Output
{
  results: VersionComparison[];
}

interface VersionComparison {
  package: string;
  installed: string;
  latest: string;
  delta: "current" | "minor-behind" | "major-behind-1" | "major-behind-2" | "major-behind-3+";
  severity: "info" | "low" | "medium" | "high" | "critical";
}
```

Severity rules: Same major, 1 minor behind → `info` Same major, 2+ minor behind → `low` 1 major behind → `medium` 2 major behind → `high` 3+ major behind → `critical` Pre-1.0 packages: minor diff treated as major diff 4.5 Analysis tools Higher-level tools that combine file reading with structured extraction. Still deterministic — no LLM. `analyze_route_structure` Scan `pages/` and/or `app/` directories and produce a route map.

```typescript
// Input
{ repoPath: string }

// Output
{
  routerType: "pages" | "app" | "hybrid";
  routes: RouteEntry[];
  apiRoutes: RouteEntry[];
  dynamicRoutes: RouteEntry[];
  catchAllRoutes: RouteEntry[];
}

interface RouteEntry {
  filePath: string;
  routePath: string;        // inferred URL path
  isDynamic: boolean;
  params?: string[];         // e.g. ["slug", "id"]
  hasGetStaticProps: boolean;
  hasGetServerSideProps: boolean;
  hasGenerateStaticParams: boolean;
  isServerComponent: boolean; // no "use client" directive
}
```

`analyze_component_directives` Scan components in a directory for `"use client"` / `"use server"` directives.

```typescript
// Input
{ path: string }

// Output
{
  total: number;
  clientComponents: number;
  serverComponents: number;
  clientRatio: number;          // 0.0 to 1.0
  clientComponentPaths: string[];
}
```

`analyze_env_usage` Scan the codebase for `process.env` references and classify them.

```typescript
// Input
{ repoPath: string }

// Output
{
  serverSide: EnvReference[];
  clientSide: EnvReference[];   // in files with "use client" or under pages/ client code
  publicVars: EnvReference[];   // NEXT_PUBLIC_ prefixed
  potentialLeaks: EnvReference[]; // non-NEXT_PUBLIC_ vars referenced in client-reachable code
}

interface EnvReference {
  varName: string;
  filePath: string;
  lineNumber: number;
  isSensitive: boolean;         // name contains KEY, SECRET, TOKEN, PASSWORD, AUTH
}
```

`analyze_middleware` Parse `middleware.ts` / `middleware.js` and identify its purpose.

```typescript
// Input
{ repoPath: string }

// Output
{
  exists: boolean;
  path?: string;
  matchers?: string[];
  detectedPurposes: string[];   // e.g. ["auth", "redirects", "i18n", "multisite", "headers"]
  imports: string[];
}
```

4.6 Web search and documentation tools These tools allow the agent to fetch current, version-specific documentation from official sources. This is what makes the agent's advice accurate for the specific versions found in the repo, rather than generic or stale. `web_search` Search the web for documentation, changelogs, migration guides, and known issues.

```typescript
// Input
{
  query: string;
  siteFilter?: string;    // restrict to a domain, e.g. "doc.sitecore.com"
  maxResults?: number;     // default 5
}

// Output
{
  results: SearchResult[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
```

`fetch_url` Fetch and extract text content from a documentation URL.

```typescript
// Input
{
  url: string;
  maxLength?: number;      // max characters to return, default 15000
  extractSelectors?: string[]; // optional CSS selectors to target, e.g. ["article", ".main-content"]
}

// Output
{
  url: string;
  title: string;
  content: string;         // extracted text, markdown-formatted
  truncated: boolean;
}
```

Implementation notes: Respects robots.txt Strips navigation, footers, ads — extracts main content only Returns markdown-formatted text, not raw HTML Truncates to `maxLength` with a notice if content exceeds limit Times out after 10 seconds and returns partial content if available Approved documentation domains The agent should prefer these authoritative sources when searching. This list is configurable in `config/approved-doc-sources.json`.

```json
{
  "sitecore": [
    "doc.sitecore.com",
    "developers.sitecore.com",
    "github.com/Sitecore",
    "github.com/sitecore/jss/blob/main/CHANGELOG.md"
  ],
  "optimizely": [
    "docs.developers.optimizely.com",
    "world.optimizely.com",
    "github.com/remkoj/optimizely-cms-nextjs"
  ],
  "nextjs": ["nextjs.org/docs", "nextjs.org/blog", "github.com/vercel/next.js/releases"],
  "general": ["developer.mozilla.org", "npmjs.com/package"]
}
```

The agent is not restricted to these domains but should prefer them when multiple results are available. Unapproved sources should be treated with lower confidence. When the agent should use web search The consulting rules instruct the agent on when to search. These are not hardcoded — they're part of the rule files. But the expected patterns are: Version-specific migration guides. Agent finds JSS 21.6 installed, latest is 22.2 → search for "Sitecore JSS 21 to 22 migration guide" and fetch the relevant page. Changelog for breaking changes. Agent finds Next.js 13 in a repo, latest is 15 → search for Next.js 14 and 15 release notes to identify breaking changes relevant to this codebase. Known issues for detected patterns. Agent finds an unusual configuration or deprecated API usage → search for whether this is a known issue with documented fixes. SDK documentation for unfamiliar patterns. Agent encounters a Sitecore or Optimizely API it doesn't have reference material for → fetch the official documentation to understand what it does before assessing it. Compatibility verification. Agent finds a specific combination of package versions → search for known compatibility issues between them. What the agent should NOT use web search for Generic "what is Next.js" type questions — the agent already knows this Searching for code solutions or fixes — the agent is auditing, not fixing Replacing the static reference knowledge base — firm opinions and patterns stay in local files Any query that would expose client-specific information (not applicable in v1 with public repos, but important for future phases) Token budget impact Web search and URL fetching consume context window space. Rules for the agent: Maximum 5 web searches per investigation run Maximum 3 URL fetches per run Fetched content counts against a separate 20,000 token documentation budget (not the main curated file budget) Agent should fetch documentation early in the investigation when it will inform subsequent tool calls, not at the end These limits are configurable in `config/tool-budget.json`. 4.7 Tracked packages for npm resolution

```typescript
const TRACKED_PACKAGES = [
  // Core framework
  'next',
  'react',
  'react-dom',
  'typescript',

  // Sitecore
  '@sitecore-jss/sitecore-jss-nextjs',
  '@sitecore-jss/sitecore-jss-react',
  '@sitecore-jss/sitecore-jss',
  '@sitecore/components',
  '@sitecore-cloudsdk/events',

  // Optimizely
  '@remkoj/optimizely-cms-nextjs',
  '@remkoj/optimizely-cms-react',
  '@remkoj/optimizely-cms-api',
  '@remkoj/optimizely-graph-client',

  // Common ecosystem
  'eslint',
  'tailwindcss',
  'graphql',
  'graphql-request',
];
```

---

5. Consulting rules (system instructions) These rules are loaded from markdown files in the `rules/` directory and injected into the agent's system prompt. They are written in plain English. Consultants can edit them without touching code. 5.1 Core investigation rules

```markdown
# Core investigation rules

## Starting an investigation

- Always begin by reading package.json to identify the stack.
- Always list the top-level directory structure to understand the project layout.
- Identify the CMS platform early — this shapes everything else you investigate.
- If you detect a monorepo, identify which workspace contains the main application before going deeper.

## Investigation priorities

- Preview and editing mode implementation is the #1 source of client escalations. Always investigate this thoroughly. Find the actual code paths, not just config.
- CMS/front-end boundaries are the #1 source of architectural confusion for new consultants. Always explain where CMS data enters the rendering layer.
- Secret and environment variable hygiene is a common audit finding. Always check for NEXT*PUBLIC* leaks and missing .env documentation.

## Depth calibration

- If the project structure is clean and conventional, you can move faster.
- If you find non-standard patterns, custom abstractions, or unexpected architecture, slow down and investigate thoroughly.
- If something looks wrong or surprising, verify it with a second tool call before recording a finding.
- Don't investigate node_modules, build output, or generated files.

## Using web search and documentation

- When you find a significantly outdated core dependency (1+ major versions behind), search for the official migration guide or changelog for the versions between installed and latest. Use this to identify specific breaking changes relevant to this codebase.
- When you encounter an SDK pattern or API you don't have reference material for, fetch the official documentation before making an assessment.
- When you find a combination of package versions that might have compatibility issues, search for known issues.
- Prefer approved documentation domains over generic search results.
- Fetch documentation early in the investigation so it can inform subsequent tool calls. Don't wait until the end.
- Summarize what you learn from documentation in your findings — don't just link to it.
- Do not use web search for things you already know or that are covered by the static reference files.

## When to stop

- You have enough to populate every required section of the deliverable.
- You have investigated all high-priority areas identified in the rules.
- Additional tool calls would not change the severity or content of your findings.
- You are approaching your tool call budget limit — prioritize output assembly.
```

5.2 Platform-specific rules These are loaded conditionally based on detected platform. Sitecore rules

```markdown
# Sitecore-specific investigation rules

## Must-investigate areas

- Component factory or component builder registration: how are components mapped to Sitecore renderings?
- Layout Service integration: is it REST or GraphQL? Connected or disconnected mode?
- Experience Editor / Sitecore Pages editing support: find the actual editing middleware, webhooks, and editing data routes.
- Multisite support: is there a site resolver? How is site context passed to the rendering layer?
- JSS SDK version: check compatibility with the detected Next.js version.

## Common Sitecore issues to look for

- Editing integration that assumes specific Sitecore instance configuration
- Component registration that will break if Sitecore template structure changes
- Hardcoded site names instead of dynamic site resolution
- Mixed use of REST and GraphQL Layout Service endpoints
- Missing or incomplete editing webhook configuration for XM Cloud

## When to search documentation

- If JSS SDK version is more than 1 major behind, fetch the JSS changelog from GitHub to identify breaking changes between installed and latest.
- If the project uses XM Cloud patterns, check doc.sitecore.com for the current XM Cloud rendering host requirements — these change with platform releases.
- If you find editing integration code you're unsure about, fetch the current Sitecore editing integration documentation to verify the pattern is still supported.
```

Optimizely rules

```markdown
# Optimizely-specific investigation rules

## Must-investigate areas

- Content Graph configuration: are preview and delivery endpoints configured separately?
- Visual Builder / On-Page Editing integration: find the actual edit mode detection and CMS page routes.
- Component-to-content-type mapping: how does the app resolve which React component renders which CMS content type?
- @remkoj package version alignment: all @remkoj/optimizely-cms-\* packages should be the same version.

## Common Optimizely issues to look for

- Content Graph queries using published endpoint when they should use draft for preview
- Missing Visual Builder configuration for on-page editing
- Content type mappings that are fragile or hardcoded rather than discoverable
- Mixed use of REST and Graph APIs without clear boundary

## When to search documentation

- If @remkoj packages are more than 2 minor versions behind, fetch the changelog from GitHub to identify breaking changes and new features.
- If you find Content Graph query patterns you're unsure about, fetch the current Optimizely Content Graph documentation to verify the approach.
- If Visual Builder integration is present, check the current docs.developers.optimizely.com documentation to verify the integration matches current requirements.
```

5.3 Goal-specific rules Loaded based on the selected analysis type. Onboarding brief rules

```markdown
# Onboarding brief rules

## What makes a good onboarding brief

- A new consultant should be able to read this and understand the project in 30 minutes.
- Lead with the big picture: what does this project do, what CMS powers it, how are they connected.
- Then get specific: where to find key files, how to run locally, what environment variables are needed.
- End with action items: what to read first, what questions to ask the client, what to watch out for.

## Required sections (all must be populated)

1. Project overview (what this is)
2. Stack and architecture (framework, CMS, key patterns)
3. Key files table (path, purpose, why it matters — minimum 10 files)
4. CMS integration explanation (how content gets to the page)
5. Preview/editing explanation (or explicit note that it's missing)
6. Environment and configuration (required env vars, deployment target)
7. Local setup steps (practical, tested against what you found)
8. Architecture scorecard (scored categories)
9. Top 5 risks (with business context)
10. Recommended first-week reading (ordered, with reasons)
11. Questions for the client team (8-12, demonstrating repo knowledge)
12. Suggested next actions (prioritized)
```

Architecture audit rules

```markdown
# Architecture audit rules

## Audit mindset

- You are reviewing this codebase as if a client is paying for an architecture assessment.
- Every finding needs evidence. No hand-waving.
- Severity must be justified. Don't inflate to look thorough. Don't minimize to be polite.
- If something is fine, say it's fine. Green categories are a valid and useful signal.

## Scoring

- Red: any critical finding, or 3+ high findings in a category
- Yellow: any high finding, or 3+ medium findings in a category
- Green: only medium, low, or info findings

## Required categories to assess

- Stack & Framework
- CMS Integration
- Preview & Editing
- Security & Configuration
- Architecture (routing, data-fetching, component patterns)
- Dependencies
- Deployment
```

Migration scout rules

```markdown
# Migration scout rules

## Investigation focus

- Identify the current version of all major dependencies.
- For each significantly outdated dependency, identify likely breaking changes.
- Look for patterns that are known to cause migration friction: custom webpack config, non-standard routing, monkey-patched modules, pinned sub-dependencies.
- Check for App Router vs Pages Router usage — this is the #1 migration decision in the Next.js ecosystem right now.

## Documentation research (critical for migration)

- For every core dependency that is 1+ major version behind, you MUST fetch the official migration guide or release notes for the versions between installed and latest.
- For Next.js specifically: fetch the upgrade guide from nextjs.org for each major version gap (e.g. 13→14, 14→15). Cross-reference what you find in the codebase against the documented breaking changes.
- For CMS SDK upgrades: fetch the changelog and identify API changes that would affect patterns found in this repo.
- Summarize the specific breaking changes that apply to this codebase — not every change in the release notes, only the ones you found evidence of in the repo.

## Output focus

- Migration hotspots: specific files/patterns that will require changes
- Estimated complexity: low/medium/high per area
- Dependency chain risks: packages that pin other packages
- Recommended migration order
- For each breaking change cited: link to the documentation source
```

5.4 How rules are loaded

```typescript
// Pseudocode for rule assembly
function buildSystemPrompt(goal: GoalType, platform: string): string {
  const parts = [
    loadRule('rules/core.md'),
    loadRule(`rules/platform-${platform}.md`), // may not exist for "unknown"
    loadRule(`rules/goal-${goal}.md`),
  ];
  return parts.filter(Boolean).join('\n\n---\n\n');
}
```

Rules are plain markdown files. No code, no templating beyond file loading. This means: A consultant can open `rules/platform-sitecore.md` and add a new investigation priority in English The agent will follow it on the next run No deployment, no recompile

---

6. Reference knowledge base Static markdown files that provide platform-specific context the agent can draw on. These are injected as additional context, not as system instructions. Structure

```
references/
├── sitecore/
│   ├── jss-nextjs-compatibility.md      # which JSS version works with which Next.js version
│   ├── xm-cloud-architecture.md         # how XM Cloud rendering host works
│   ├── editing-integration-patterns.md  # Experience Editor, Pages, editing webhooks
│   └── common-antipatterns.md           # things your firm sees go wrong repeatedly
├── optimizely/
│   ├── content-graph-setup.md           # preview vs delivery, authentication
│   ├── visual-builder-integration.md    # on-page editing requirements
│   ├── cms-sdk-compatibility.md         # @remkoj package version alignment
│   └── common-antipatterns.md
├── nextjs/
│   ├── app-router-migration-guide.md    # known gotchas for pages→app migration
│   ├── server-component-patterns.md     # when to use client vs server components
│   ├── caching-strategies.md            # ISR, revalidate, fetch cache
│   └── security-headers-checklist.md
└── consulting/
    ├── risk-severity-guide.md           # when to flag critical vs high vs medium
    ├── onboarding-quality-bar.md        # what a good onboarding brief looks like
    └── client-question-patterns.md      # types of questions that demonstrate expertise
```

How references are used References are NOT dumped into context all at once. The agent selectively loads relevant reference files based on detected platform and current investigation focus.

```
# Example agent reasoning:
# "I detected Sitecore packages. Let me load the Sitecore reference files."
# → Agent calls: read_file("references/sitecore/jss-nextjs-compatibility.md")
#
# "I found preview-related code. Let me check the editing integration patterns."
# → Agent calls: read_file("references/sitecore/editing-integration-patterns.md")
```

This keeps context window usage efficient and demonstrates agentic behavior — the agent decides what reference material it needs based on what it's finding. Static references vs dynamic documentation The knowledge base has two layers that serve different purposes: Static references (in `references/`) contain your firm's opinions, patterns, and institutional knowledge. These are things like "we prefer X pattern over Y because we've seen Y break in production" or "these JSS versions are compatible with these Next.js versions based on our project experience." These rarely change and capture knowledge that isn't available in official docs. Dynamic documentation (via `web_search` and `fetch_url`) contains version-specific, current information from official sources. These are things like "the JSS 22.0 changelog says API X was removed" or "the Next.js 15 upgrade guide says middleware behavior changed." These change with every release and would be impractical to maintain as static files. The agent uses both: Static references for firm-specific context and opinionated assessments Dynamic docs for version-specific facts and breaking change details When they overlap (e.g. the static reference says "JSS 21→22 changes the editing API" and the fetched changelog confirms the specifics), the agent cites both — the firm's assessment of impact plus the official documentation of the change. Authoring reference files Reference files should be written by senior consultants and capture firm-specific knowledge: Known compatibility matrices (not documented publicly or hard to find) Common mistakes your firm sees across client projects Your firm's preferred patterns and why Decision frameworks for common architectural choices These are the files that make the agent's output feel like it came from your senior architects rather than a generic LLM.

---

7. Output schemas 7.1 Scorecard The scorecard is the primary structured output. Scored, diffable, machine-readable.

```typescript
interface Scorecard {
  metadata: {
    repoName: string;
    repoUrl?: string;
    analysisDate: string;
    agentVersion: string;
    goalType: string;
    detectedPlatform: string;
    toolCallsUsed: number;
    webSearchesUsed: number;
    urlFetchesUsed: number;
    documentationSources: { url: string; title: string }[];
    investigationLog: InvestigationEntry[]; // full reasoning trace
  };
  overallScore: Score;
  categories: ScorecardCategory[];
  topRisks: RankedRisk[];
  findings: Finding[];
}

interface Score {
  rating: 'green' | 'yellow' | 'red';
  label: string;
  summary: string;
}

interface ScorecardCategory {
  name: string;
  score: Score;
  findingCount: { critical: number; high: number; medium: number; low: number; info: number };
  keyFindings: string[];
}

interface RankedRisk {
  rank: number;
  findingId: string;
  title: string;
  severity: string;
  businessContext: string;
  recommendation: string;
}
```

Scoring rules (from consulting rules, not hardcoded): Red: any critical, or 3+ high Yellow: any high, or 3+ medium Green: only medium, low, or info Scorecard categories Category Finding categories Stack & Framework `stack`, `nextjs` CMS Integration `cms-integration` Preview & Editing `preview-editing` Security & Configuration `security`, `configuration` Architecture `architecture`, `routing`, `data-fetching` Dependencies `dependencies` Deployment `deployment` 7.2 Narrative brief Consultant-readable markdown. Sections are required by the goal-specific rules but populated by the agent based on its investigation.

```markdown
# Project Onboarding Brief: {repo_name}

**Generated:** {date} **Platform:** {detected platform} **Goal:** {goal type} **Investigation depth:** {tool calls used} / {budget}

---

## Project overview

{what this project is and does — 3-5 sentences}

## Stack and architecture

{framework, CMS, key architectural patterns}

### Key files to know

| File | Purpose | Why it matters |
| ---- | ------- | -------------- |

{minimum 10 rows}

## CMS integration approach

{how CMS content reaches the rendering layer}

## Preview and editing flow

{how preview/editing works, or explicit note that it's missing}

## Configuration and environment

{required env vars, deployment target, config assumptions}

## Local setup steps

{practical steps based on what the agent found}

## Architecture scorecard

{rendered scorecard categories with scores}

## Top risks

{top 5 with business context and recommendations}

## Recommended first-week reading

{ordered list with reasons}

## Questions for the client team

{8-12 questions that demonstrate repo knowledge}

## Suggested next actions

{prioritized}

---

## Documentation sources

{list of external docs fetched during investigation, with URLs and what they informed}

## Investigation log

{optional: summary of what the agent investigated and why}
```

7.3 JSON export Every run produces a raw JSON file containing: full `AgentState` at completion all findings with evidence investigation log (full reasoning trace) scorecard data This enables: diffing across runs, debugging agent behavior, auditing investigation quality.

---

8. File structure

```
repo-audit-delivery-agent/
├── README.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                        # CLI entry point
│   ├── types/
│   │   ├── finding.ts                  # Finding, Evidence, FindingCategory
│   │   ├── state.ts                    # AgentState, InvestigationEntry
│   │   ├── output.ts                   # Scorecard, Brief schemas
│   │   ├── tools.ts                    # Tool input/output types
│   │   └── provider.ts                 # ModelProvider interface
│   ├── tools/
│   │   ├── registry.ts                 # Tool registration with Pi
│   │   ├── repo/
│   │   │   ├── clone.ts                # clone_repo
│   │   │   ├── listDirectory.ts        # list_directory
│   │   │   ├── readFile.ts             # read_file
│   │   │   └── readFilesBatch.ts       # read_files_batch
│   │   ├── search/
│   │   │   ├── grepPattern.ts          # grep_pattern
│   │   │   └── findFiles.ts            # find_files
│   │   ├── web/
│   │   │   ├── webSearch.ts            # web_search
│   │   │   ├── fetchUrl.ts             # fetch_url
│   │   │   └── approvedSources.ts      # approved domain loader
│   │   ├── config/
│   │   │   ├── parsePackageJson.ts     # parse_package_json
│   │   │   ├── parseNextConfig.ts      # parse_next_config
│   │   │   ├── parseTsconfig.ts        # parse_tsconfig
│   │   │   ├── parseEnvFile.ts         # parse_env_file
│   │   │   └── checkGitignore.ts       # check_gitignore
│   │   ├── dependencies/
│   │   │   ├── queryNpmVersions.ts     # query_npm_versions
│   │   │   ├── compareVersions.ts      # compare_versions
│   │   │   └── cache.ts               # version cache management
│   │   └── analysis/
│   │       ├── analyzeRouteStructure.ts
│   │       ├── analyzeComponentDirectives.ts
│   │       ├── analyzeEnvUsage.ts
│   │       └── analyzeMiddleware.ts
│   ├── agent/
│   │   ├── goalPrompts.ts              # goal prompt templates
│   │   ├── systemPrompt.ts             # assembles system prompt from rules + references
│   │   └── outputAssembler.ts          # builds final deliverable from agent state
│   ├── rules/                          # loaded at runtime, editable by consultants
│   │   ├── core.md
│   │   ├── platform-sitecore.md
│   │   ├── platform-optimizely.md
│   │   ├── goal-onboarding.md
│   │   ├── goal-audit.md
│   │   └── goal-migration.md
│   ├── references/                     # static knowledge base
│   │   ├── sitecore/
│   │   ├── optimizely/
│   │   ├── nextjs/
│   │   └── consulting/
│   ├── providers/
│   │   ├── portkey.ts                  # Portkey gateway → Bedrock provider
│   │   └── registry.ts
│   └── output/
│       ├── scorecard.ts
│       ├── brief.ts
│       └── json.ts
└── test/
    ├── tools/                          # unit tests for each tool
    ├── fixtures/                       # minimal repo fixtures
    └── integration/                    # full agent runs against fixture repos
```

---

9. Agent execution flow This is what actually happens at runtime. It is NOT a hardcoded pipeline — the inner loop is driven by agent reasoning. Pre-loop (deterministic, not agent-driven)

```
1. Parse CLI input (repo URL/path, goal type, optional platform override)
2. Clone repo if remote
3. Resolve npm versions for tracked packages (cached, 24h TTL)
4. Assemble system prompt:
   a. Load core rules
   b. Load goal-specific rules
   c. Platform rules loaded later once platform is detected
5. Register all tools with Pi
6. Initialize AgentState
7. Start agent loop
```

Agent loop (driven by agent reasoning, not hardcoded) The agent receives the system prompt and a goal prompt like:

```
You have access to a repository cloned at {localPath}.
Your goal is to produce an {goalType} for this project.

Begin by understanding the project structure and stack.
Then investigate according to your consulting rules.
Record findings as you go.
When you have enough information to populate every required section
of the deliverable, call the `assemble_output` tool.

npm version data is available via the query_npm_versions and
compare_versions tools.

You can search the web and fetch documentation using the web_search
and fetch_url tools. Use these when you find outdated dependencies,
unfamiliar SDK patterns, or version-specific issues that your
reference material doesn't cover. Prefer approved documentation
sources. Your web search budget is limited — use it where it adds
the most value.
```

The agent then executes its own investigation plan. A typical flow might look like:

```
Agent reasoning: "Let me start by understanding the project structure."
→ calls: list_directory({ path: "/", depth: 2 })
→ calls: parse_package_json({})

Agent reasoning: "I see @sitecore-jss packages. This is a Sitecore project.
                  Let me load the Sitecore reference material and check JSS version compatibility."
→ calls: read_file({ path: "references/sitecore/jss-nextjs-compatibility.md" })
→ calls: compare_versions({ installed: [...], latest: resolvedVersions })
→ records finding: DEP-JSS-OUTDATED (medium)

Agent reasoning: "JSS is 1 major version behind. My rules say I should fetch the migration guide
                  to identify specific breaking changes relevant to this codebase."
→ calls: web_search({ query: "Sitecore JSS 21 to 22 migration changelog", siteFilter: "github.com/sitecore/jss" })
→ calls: fetch_url({ url: "https://github.com/Sitecore/jss/blob/main/CHANGELOG.md", maxLength: 10000 })
→ updates finding: DEP-JSS-OUTDATED — adds specific breaking changes from changelog that affect patterns found in this repo

Agent reasoning: "The rules say preview/editing is the #1 priority. Let me find it."
→ calls: grep_pattern({ pattern: "draftMode|preview", fileGlob: "*.ts,*.tsx" })
→ calls: read_file({ path: "src/pages/api/editing/render.ts" })
→ calls: read_file({ path: "src/lib/page-props-factory/plugins/preview-mode.ts" })
→ records finding: PREVIEW-EDITING-PRESENT (info, with detailed evidence)

Agent reasoning: "I found editing render middleware. Let me check if it's properly configured
                  for XM Cloud webhooks. The reference material mentions this is often missing."
→ calls: grep_pattern({ pattern: "EditingRenderMiddleware|editingDataService" })
→ calls: read_file({ path: "src/pages/api/editing/data/[key].ts" })
→ records finding: EDITING-WEBHOOK-CONFIGURED (info)

Agent reasoning: "Now let me check the component registration pattern."
→ calls: find_files({ pattern: "componentFactory*" })
→ calls: read_file({ path: "src/temp/componentFactory.ts" })
→ calls: grep_pattern({ pattern: "import.*from.*components" })
→ records finding: COMPONENT-FACTORY-AUTOGEN (info, "generated by scaffold — standard pattern")

... continues until goal sections can be populated ...

Agent reasoning: "I have enough findings for all required sections. Let me assemble the output."
→ calls: assemble_output({ goalType: "onboarding", findings: [...] })
```

Key behaviors the agent demonstrates: Adaptive investigation: the path through tools depends on what's found Reference-informed reasoning: agent loads platform docs when relevant Documentation-driven findings: agent fetches version-specific docs to ground its findings in current reality, not stale training data Depth calibration: standard patterns get brief notes, unusual patterns get deep dives Cross-referencing: findings in one area trigger investigation in related areas Budget awareness: agent tracks tool call count and web search budget, prioritizes accordingly Post-loop (deterministic)

```
8. Output assembler validates all required sections are populated
9. Scorecard computed from findings (scoring rules are deterministic)
10. Files written to output directory
```

---

10. Goal prompts These are the initial prompts given to the agent based on the user's selected goal. Onboarding

```
You have access to a repository at {localPath}.
Produce a consultant onboarding brief for a developer joining this project for the first time.

Your consulting rules specify the required sections and quality bar.
Investigate the repository using your tools, record findings, and assemble the brief
when you have sufficient information.

Start by understanding the stack, then investigate CMS integration, preview/editing,
and configuration. Follow your platform-specific rules once you identify the CMS.
```

Architecture audit

```
You have access to a repository at {localPath}.
Produce a scored architecture audit for this project.

Every category in the scorecard must have a score based on real findings with evidence.
If a category is healthy, score it green with a brief note — do not inflate findings.
If you find real issues, document them with file paths and code evidence.

Your consulting rules define the scoring criteria and required categories.
```

Migration scout

```
You have access to a repository at {localPath}.
Assess this project's migration readiness and produce a migration report.

Focus on: dependency currency, framework version, router architecture,
deprecated patterns, and migration-hostile code. Use the npm version tools
to check current versions. Consult your reference material for known
migration gotchas.

Produce a prioritized list of migration hotspots with estimated complexity.
```

---

11. `assemble_output` tool This is a special tool the agent calls when it's ready to produce its deliverable. It's the bridge between the agentic investigation and the structured output.

```typescript
// Input
{
  goalType: GoalType;
  sections: Record<string, string>;  // section key → agent-written content
  findings: Finding[];
  stackProfile: StackProfile;
}

// Output
{
  scorecard: Scorecard;              // computed from findings
  brief: string;                     // rendered markdown
  json: string;                      // full export
  outputPaths: string[];             // files written
}
```

The agent populates `sections` with its narrative for each required section. The assembler: Validates all required sections are present (based on goal type) Computes the scorecard from findings (deterministic scoring) Renders the brief from sections + scorecard Exports full JSON Writes files to the output directory This keeps the output structure enforced while letting the agent write the narrative content.

---

12. CLI interface Commands

```bash
# Full analysis with interactive prompts
repo-audit-delivery-agent analyze

# Direct invocation
repo-audit-delivery-agent analyze --repo https://github.com/Sitecore/xmcloud-starter-js \
                          --goal onboarding \
                          --output ./output

# With explicit platform (skip auto-detection)
repo-audit-delivery-agent analyze --repo ./local-repo \
                          --goal audit \
                          --platform sitecore \
                          --output ./output

# Refresh npm version cache
repo-audit-delivery-agent versions --refresh

# List registered tools
repo-audit-delivery-agent tools --list

# Validate rules files
repo-audit-delivery-agent rules --validate

# Dry run: show what system prompt and tools would be configured, without running
repo-audit-delivery-agent analyze --repo ./local-repo --goal onboarding --dry-run
```

Interactive flow

```
? Repository URL or local path: https://github.com/Sitecore/xmcloud-starter-js
? Analysis goal:
  ❯ Onboarding brief
    Architecture audit
    Migration scout
? Output directory: ./output
? Tool call budget [50]:

Cloning repository...
Resolving npm versions...
Starting investigation...

[Step 1]  list_directory /  → 23 entries
[Step 2]  parse_package_json → Sitecore JSS 22.1 / Next.js 14.1
[Step 3]  Loading Sitecore rules and references...
[Step 4]  grep_pattern "draftMode|preview" → 7 matches
...
[Step 31] Assembling output...

✓ Scorecard:  ./output/xmcloud-starter-js-scorecard.json
✓ Brief:      ./output/xmcloud-starter-js-brief.md
✓ Full export: ./output/xmcloud-starter-js-export.json

Investigation complete. 31 tool calls, 24 findings, 4 minutes.
```

Output files

```
output/
├── {repo-name}-scorecard.json
├── {repo-name}-scorecard.md
├── {repo-name}-brief.md              # if goal = onboarding
├── {repo-name}-findings.json
├── {repo-name}-export.json            # full agent state + investigation log
└── {repo-name}-investigation.md       # human-readable investigation trace
```

---

13. Target demo repositories Primary: Sitecore Repo: `Sitecore/xmcloud-starter-js` Why: Canonical XM Cloud starter. JSS integration, Next.js, multisite, editing/preview, component factory. Complex enough for a meaningful demo. Expected agent behavior: Detects Sitecore via `@sitecore-jss` packages Loads Sitecore-specific rules and references Investigates editing middleware and webhook configuration (priority per rules) Traces component factory to understand rendering registration Checks JSS/Next.js version compatibility via reference material Examines multisite resolver and middleware Produces platform-specific findings, not generic observations Primary: Optimizely Repo: `remkoj/optimizely-saas-starter` Why: De facto community reference for Optimizely SaaS CMS + Next.js + Content Graph. Visual Builder, preview, component mapping. Expected agent behavior: Detects Optimizely via `@remkoj/optimizely-cms-*` packages Loads Optimizely-specific rules and references Investigates Content Graph preview vs delivery endpoint configuration Checks Visual Builder integration (priority per rules) Verifies `@remkoj` package version alignment Examines component-to-content-type mapping convention Produces platform-specific findings, not generic observations Demo validation Run the same goal (`onboarding`) against both repos. The demo is successful if: The agent takes visibly different investigation paths for each repo Findings reference platform-specific patterns, not just generic Next.js observations The investigation log shows adaptive reasoning (earlier findings shaping later investigation) The output would be useful to a real consultant joining the project A senior architect watching the demo can see that the rules and references shaped the agent's behavior

---

14. Backend provider abstraction Interface

```typescript
interface ModelProvider {
  id: string;
  name: string;
  runAgent(request: AgentRequest): Promise<AgentResponse>;
}

interface AgentRequest {
  systemPrompt: string;
  goalPrompt: string;
  tools: ToolDefinition[];
  maxToolCalls: number;
  referenceContext?: string; // loaded reference files
}

interface AgentResponse {
  findings: Finding[];
  sections: Record<string, string>;
  stackProfile: StackProfile;
  investigationLog: InvestigationEntry[];
  usage: { inputTokens: number; outputTokens: number; toolCalls: number };
}
```

v1 implementation: Portkey + Amazon Bedrock The v1 provider routes through Portkey (AI gateway) to Amazon Bedrock (model host). This gives us: Gateway-level observability, logging, and cost tracking via Portkey Access to Claude models on Bedrock using existing company AWS credentials A clean provider swap path if we later want to route to Anthropic direct, Vertex AI, or other providers — just change the Portkey virtual key and model ID How Portkey + Bedrock works Portkey is an AI gateway that provides an OpenAI-compatible API. You create a "virtual key" in Portkey's dashboard that wraps your AWS credentials (access key, secret key, region). All requests go through Portkey's gateway URL, which routes them to Bedrock.

```typescript
import Portkey from 'portkey-ai';

const client = new Portkey({
  apiKey: process.env.PORTKEY_API_KEY, // Portkey API key
  virtualKey: process.env.PORTKEY_VIRTUAL_KEY, // Wraps AWS Bedrock credentials
});

const response = await client.chat.completions.create({
  model: 'us.anthropic.claude-sonnet-4-20250514-v1:0', // Bedrock model ID
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: goalPrompt },
  ],
  tools: toolDefinitions,
  max_tokens: 8192,
});
```

Setup steps Portkey account: Sign up at portkey.ai and get a Portkey API key Virtual key: In the Portkey dashboard, go to Virtual Keys → Create → Select "Bedrock" as provider → Enter your AWS Access Key ID, AWS Secret Access Key, and AWS Region Environment variables: Set `PORTKEY_API_KEY` and `PORTKEY_VIRTUAL_KEY` in your `.env` Bedrock model access: Ensure Claude models are enabled in your AWS Bedrock console for the configured region Required environment variables

```bash
# .env (never committed — add to .gitignore)
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_VIRTUAL_KEY=your-bedrock-virtual-key

# Optional: direct Bedrock credentials if not using Portkey virtual keys
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1
```

Bedrock model IDs Use Bedrock-format model IDs, not Anthropic-format:

```typescript
const BEDROCK_MODELS = {
  sonnet: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};
```

Use Sonnet as the default for the agent loop (best balance of intelligence and cost for multi-step reasoning with tool calls). Haiku is available as a faster/cheaper option for simpler analysis tasks if budget optimization is needed later. Tool calling through Portkey Portkey passes tool definitions and tool call responses through to Bedrock transparently. The agent's tool calling works the same as it would with the Anthropic API directly — Portkey just proxies the request. No special handling is needed beyond using the Portkey SDK instead of the Anthropic SDK. Provider swap Swapping the backend requires: Create a new Portkey virtual key pointing to the new provider (e.g. Anthropic direct, Azure, Vertex) Update the model ID in configuration Update the `PORTKEY_VIRTUAL_KEY` environment variable Or, to swap away from Portkey entirely: Implement the `ModelProvider` interface for the new provider's SDK Ensure the new provider supports tool calling Update configuration No changes to: tools, rules, references, output assembly, or CLI.

---

15. Implementation sequence Phase 1: Tools (build first) Set up project structure, TypeScript config, build tooling Implement repo tools: `clone_repo`, `list_directory`, `read_file`, `read_files_batch` Implement search tools: `grep_pattern`, `find_files` Implement config parsing tools: `parse_package_json`, `parse_next_config`, `parse_tsconfig`, `parse_env_file`, `check_gitignore` Implement dependency tools: `query_npm_versions`, `compare_versions`, cache Implement analysis tools: `analyze_route_structure`, `analyze_component_directives`, `analyze_env_usage`, `analyze_middleware` Implement web tools: `web_search`, `fetch_url`, approved sources loader Unit test every tool against fixture repos Phase 2: Rules + references (build second) Write core investigation rules (including web search guidance) Write Sitecore platform rules (including when to search Sitecore docs) Write Optimizely platform rules (including when to search Optimizely docs) Write goal-specific rules (onboarding, audit, migration — migration has heaviest web search guidance) Configure approved documentation sources Write initial reference knowledge base files (start with compatibility matrices and common anti-patterns) Implement rule loader and system prompt assembler Phase 3: Agent integration (build third) Implement Pi tool registration (wire all tools from phases 1-2) Implement goal prompt templates Implement provider abstraction with Portkey → Bedrock provider Implement `assemble_output` tool Implement scorecard computation (deterministic scoring from findings) Implement brief renderer Implement JSON export Run first end-to-end test against `xmcloud-starter-js` Phase 4: CLI + polish (build last) Implement CLI with interactive prompts Implement investigation log renderer (human-readable trace) Run against both target repos, compare outputs Iterate on rules and references based on output quality Iterate on goal prompts based on investigation behavior Why this order matters Tools first because they're deterministic and testable in isolation. Rules second because they need to be written by a human reviewing what the tools produce. Agent integration third because it depends on working tools and finalized rules. CLI last because it's just the wrapper.

---

16. Testing strategy Tool tests Every tool gets a unit test with a minimal fixture repo. The fixture contains just enough files to exercise the tool's logic. Example fixture for `parse_next_config`:

```
fixtures/next-config-basic/
├── package.json
└── next.config.js    # module.exports = { images: { domains: ["cdn.example.com"] }, output: "standalone" }
```

Test: `parse_next_config` should return `{ images: { domains: ["cdn.example.com"] }, output: "standalone" }`. Agent behavior tests These are integration tests that run the full agent loop against fixture repos and assert on: Minimum finding count Presence of specific expected findings Investigation log contains expected tool calls All required output sections are populated Scorecard categories all have scores These tests use a real model provider (not mocked) because the agent's reasoning is the thing being tested. Rule validation tests Lint rules files for: Valid markdown structure No empty required sections headers Platform rules reference tools that exist Goal rules reference output sections that exist Regression approach Store output snapshots (findings + scorecard) from runs against target repos. After changes to rules or prompts, diff new output against stored snapshots. Flag significant changes for human review.

---

17. Configuration

```
repo-audit-delivery-agent/
├── config/
│   ├── provider.json              # model provider config
│   ├── tracked-packages.json      # npm packages to resolve
│   ├── tool-budget.json           # default budget per goal type
│   └── approved-doc-sources.json  # preferred documentation domains per platform
```

provider.json

```json
{
  "gateway": "portkey",
  "provider": "bedrock",
  "model": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "maxTokens": 8192,
  "portkeyBaseUrl": "https://api.portkey.ai/v1"
}
```

Environment variables required (not in config file): `PORTKEY_API_KEY` — your Portkey API key `PORTKEY_VIRTUAL_KEY` — your Portkey virtual key wrapping Bedrock credentials tool-budget.json

```json
{
  "onboarding": {
    "toolCalls": 50,
    "webSearches": 5,
    "urlFetches": 3,
    "docTokenBudget": 20000
  },
  "audit": {
    "toolCalls": 60,
    "webSearches": 5,
    "urlFetches": 3,
    "docTokenBudget": 20000
  },
  "migration": {
    "toolCalls": 40,
    "webSearches": 8,
    "urlFetches": 5,
    "docTokenBudget": 30000
  }
}
```

Note: migration gets a higher web search budget because it's the goal most dependent on version-specific external documentation. Onboarding and audit lean more on repo investigation. approved-doc-sources.json

```json
{
  "sitecore": [
    "doc.sitecore.com",
    "developers.sitecore.com",
    "github.com/Sitecore",
    "github.com/sitecore/jss"
  ],
  "optimizely": [
    "docs.developers.optimizely.com",
    "world.optimizely.com",
    "github.com/remkoj/optimizely-cms-nextjs"
  ],
  "nextjs": ["nextjs.org/docs", "nextjs.org/blog", "github.com/vercel/next.js/releases"],
  "general": ["developer.mozilla.org", "npmjs.com/package"]
}
```

---

18. Constraints and guardrails Read-only analysis. The agent never modifies the target repo. No secrets in output. All tools redact values that look like keys/tokens/passwords. No client data in v1. Only public repos. Tool budget enforced. The agent cannot exceed its configured tool call limit. Web search budget enforced. Separate limits for web searches and URL fetches per run, configurable per goal type. Documentation token budget enforced. Fetched documentation content has its own token ceiling to prevent context window saturation. Approved sources preferred. The agent prioritizes documentation from configured approved domains. Findings that cite unapproved sources should note lower confidence. No query leakage in future phases. When client repos are supported, web search queries must never include client-identifying information (repo names, internal URLs, proprietary terms). This is not enforced in v1 (public repos only) but the architecture should anticipate it. Evidence required. Every finding must have at least one evidence entry with a file path. The output assembler rejects findings without evidence. Reasoning trace preserved. The investigation log captures every tool call and the agent's reasoning. This is auditable. Rules are version-controlled. They live in the repo, not in an external service. References are version-controlled. Same. Approved sources are version-controlled. Same.

---

19. What makes this agentic (not a pipeline) For the avoidance of doubt, here are the specific behaviors that distinguish this from the previous pipeline architecture: Pipeline (v1 spec) Agentic (this spec) Fixed sequence: clone → detect → run all checks → interpret → render Dynamic: agent decides what to investigate based on what it finds Every check runs every time Agent selects relevant tools based on detected platform and emerging findings Interpretation is one LLM call at the end Reasoning happens throughout — every tool call result shapes the next action Adding a check = writing a function and adding it to the loop Adding a tool = registering it; adding a rule = editing a markdown file Output structure is hardcoded Output structure is enforced by assembler, content is agent-written Investigation depth is uniform Agent goes deeper on unusual/risky areas, lighter on clean/standard areas No reasoning trace Full investigation log with per-step reasoning Platform rules are code Platform rules are plain English, editable by consultants Can't explain why it investigated something Every tool call has a reasoning annotation Static version table maintained manually Live npm resolution + web search for version-specific migration docs No external documentation access Agent fetches official docs when it finds version gaps or unfamiliar patterns

---

20. Success criteria for v1 Running against `Sitecore/xmcloud-starter-js` produces a scorecard and brief that a Sitecore consultant finds accurate and useful Running against `remkoj/optimizely-saas-starter` produces a scorecard and brief that an Optimizely consultant finds accurate and useful The agent takes visibly different investigation paths for each repo (observable in investigation log) The scorecard contains at least 20 specific findings per repo with file-level evidence The investigation log shows adaptive reasoning — not a linear march through tools Adding a new platform rule in English changes agent behavior on the next run without code changes Adding a new tool requires only implementing the function and registering it — no orchestration changes Swapping the model provider requires changing only configuration The investigation log is readable by a non-technical manager and explains what the agent did and why When the agent finds an outdated dependency, it fetches version-specific documentation and cites specific breaking changes relevant to the codebase — not generic "you should upgrade" advice Findings that reference external documentation include the source URL, making them verifiable A senior architect watching the demo says "this investigated the repo the way I would"
