import type { AnalysisTurn, Finding } from '@/lib/runTransform';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';

// ─── Sample data extracted from run sitecore-minimal-onboarding-2026-04-02T18-25-21-344Z ───

export const SAMPLE_ANALYSIS_TURNS: AnalysisTurn[] = [
  {
    reasoning: "I'll start by investigating the project structure and stack simultaneously.",
    activities: [
      { label: 'list_directory', files: ['.'], detail: 'Scanning root at depth 2' },
      { label: 'parse_package_json', files: ['package.json'], detail: 'Sitecore JSS 21.6.0 + Next.js 14' },
    ],
    categoriesCovered: ['stack'],
    duration: 4400,
  },
  {
    reasoning: 'Good — this is a Sitecore JSS project using Next.js 14. Let me dive deeper into the structure and also fetch the JSS changelog early.',
    activities: [
      { label: 'list_directory', files: ['src/'], detail: '2 routers (app/ + pages/), 2 components, middleware' },
      { label: 'fetch_url', files: [], detail: 'github.com/Sitecore/jss/blob/main/CHANGELOG.md' },
    ],
    categoriesCovered: ['dependencies'],
    duration: 7100,
  },
  {
    reasoning: 'The CHANGELOG shows JSS is at the "Unreleased" / 21.1.x range in the changelog, but the project uses 21.6.0. Let me check the current latest JSS version, read the key files, and investigate the hybrid router structure.',
    activities: [
      { label: 'read_files_batch', files: ['next.config.js', 'tsconfig.json', 'src/middleware.ts', 'src/pages/[[...path]].tsx', 'src/pages/index.tsx'], detail: '5 files in single batch' },
      { label: 'query_npm_versions', files: [], detail: 'Next.js 14.0.0 → 15.x, React 18 → 19 available' },
    ],
    categoriesCovered: ['cms-integration', 'configuration'],
    duration: 4100,
  },
  {
    reasoning: 'Major version gaps everywhere. Now let me look at the App Router editing endpoint and components.',
    activities: [
      { label: 'list_directory', files: ['src/app'], detail: 'App Router structure with [site]/[locale] nesting' },
      { label: 'read_files_batch', files: ['src/components/ClientWidget.tsx', 'src/components/ServerCard.tsx'], detail: "1 'use client', 1 server component" },
      { label: 'read_file', files: ['src/app/api/editing/route.ts'], detail: 'Returns empty OK — no secret validation' },
      { label: 'read_files_batch', files: ['src/app/[site]/[locale]/[[...path]]/page.tsx', 'src/lib/dictionary-service.ts', 'src/lib/layout-service.ts', 'src/lib/component-props.ts'], detail: 'force-dynamic set, stub layoutData' },
    ],
    categoriesCovered: ['preview-editing', 'routing'],
    duration: 12200,
  },
  {
    reasoning: 'The middleware has a hardcoded/redacted API key! Let me check the actual file more carefully, and also look at the pages router parts.',
    activities: [
      { label: 'read_file', files: ['src/middleware.ts'], detail: 'Hardcoded API key in matcher config' },
      { label: 'analyze_env_usage', files: [], detail: '4 env vars referenced across codebase' },
      { label: 'parse_env_file', files: ['.env.example'], detail: 'SITECORE_API_KEY has default value' },
      { label: 'analyze_route_structure', files: [], detail: 'Hybrid: Pages + App Router catch-alls compete' },
      { label: 'analyze_middleware', files: [], detail: 'Matches /api/:path*, no security headers' },
      { label: 'analyze_component_directives', files: ['src/components'], detail: "1 'use client', 1 server component" },
      { label: 'check_gitignore', files: [], detail: '.env and .env.local properly ignored' },
      { label: 'compare_versions', files: [], detail: 'JSS 21.6→22.12, Next 14→15, React 18→19' },
      { label: 'grep_pattern', files: [], detail: 'NEXT_PUBLIC_, force-dynamic, layoutData, security headers, getStaticPaths' },
      { label: 'find_files', files: [], detail: '*.test.*, *.spec.*, *.env*, README* — zero test files found' },
    ],
    categoriesCovered: ['security', 'architecture', 'data-fetching'],
    duration: 238000,  // ~4 min — this was the big parallel burst with budget extension
  },
  {
    reasoning: 'Now I have enough evidence. Let me read the full middleware file and the parse results to complete my picture.',
    activities: [
      { label: 'read_file', files: ['src/middleware.ts'], detail: 'Confirmed: API key visible in source' },
      { label: 'read_file', files: ['src/pages/index.tsx'], detail: 'No deployment config, no CI, no env strategy' },
    ],
    categoriesCovered: ['deployment'],
    duration: 6500,
  },
  {
    reasoning: 'Now I have a complete picture of the project. Let me switch to the fast model and record all findings.',
    activities: [
      { label: 'switch_to_fast_model', files: [], detail: '50 tool calls used, 11 categories covered' },
    ],
    categoriesCovered: ['nextjs'],
    duration: 1200,
  },
];

export const SAMPLE_FINDINGS: Finding[] = [
  // Batch 1 (batchId c53e120f — 4 findings)
  { id: 'STACK-JSS-OUTDATED', severity: 'high', category: 'stack', title: 'Sitecore JSS is 1 major version behind latest',
    evidenceFiles: ['package.json', 'package.json', 'next.config.js'], evidence: [], tags: ['dependencies', 'upgrades', 'sitecore-jss'],
    note: 'Confirmed via npm query. Latest JSS is 22.12.0. Migration will require updated component patterns and App Router alignment.' },
  { id: 'DEPS-NEXTJS-OUTDATED', severity: 'medium', category: 'dependencies', title: 'Next.js is 1 major version behind latest',
    evidenceFiles: ['package.json'], evidence: [], tags: ['dependencies', 'nextjs', 'upgrades'],
    note: 'Next.js 15.x introduces more aggressive ISR defaults and streaming optimizations.' },
  { id: 'DEPS-REACT-OUTDATED', severity: 'low', category: 'dependencies', title: 'React and React DOM several versions behind latest',
    evidenceFiles: ['package.json', 'package.json'], evidence: [], tags: ['dependencies', 'react', 'upgrades'],
    note: 'Lower priority than JSS/Next.js since 18.x is stable. React 19 upgrade is additive, not required.' },
  { id: 'CMS-HYBRID-ROUTER', severity: 'medium', category: 'cms-integration', title: 'Hybrid router architecture mixing Pages and App Router',
    evidenceFiles: ['src/pages/[[...path]].tsx', 'src/app/[site]/[locale]/[[...path]]/page.tsx', 'src/pages/api/editing/render.ts', 'src/app/api/editing/route.ts'], evidence: [], tags: ['architecture', 'cms-integration', 'hybrid-router'],
    note: 'Hybrid pattern works technically but signals incomplete migration. JSS 22.x strongly recommends App Router-first.' },
  // Batch 2 (batchId 04172057 — 5 findings)
  { id: 'PREVIEW-INCOMPLETE', severity: 'high', category: 'preview-editing', title: 'Editing/preview integration is incomplete and non-functional',
    evidenceFiles: ['src/pages/api/editing/render.ts', 'src/app/api/editing/route.ts', 'src/middleware.ts'], evidence: [], tags: ['cms-integration', 'preview-editing', 'sitecore-editing'],
    note: 'Skeleton implementation. Editors cannot preview draft content — Layout Service integration missing entirely.' },
  { id: 'SEC-HARDCODED-KEY', severity: 'critical', category: 'security', title: 'Potential hardcoded/redacted API key in middleware',
    evidenceFiles: ['src/middleware.ts', '.env.example', 'src/middleware.ts'], evidence: [], tags: ['security', 'secrets', 'api-keys'],
    note: 'The [REDACTED] marker suggests detection patterns triggered. Need to verify if live key or placeholder.' },
  { id: 'SEC-MISSING-HEADERS', severity: 'medium', category: 'security', title: 'Security headers not explicitly configured',
    evidenceFiles: ['next.config.js'], evidence: [], tags: ['security', 'configuration', 'headers'],
    note: 'Sitecore Experience Editor requires frame embedding — X-Frame-Options must allow cm.example.com.' },
  { id: 'CONFIG-ENV-UNDERDOC', severity: 'medium', category: 'configuration', title: 'Environment variables documented but not explained',
    evidenceFiles: ['.env.example'], evidence: [], tags: ['configuration', 'environment', 'documentation'],
    note: 'SITECORE_API_HOST should match CM server. JSS_APP_NAME must match Sitecore app registration.' },
  { id: 'ARCH-FORCE-DYNAMIC', severity: 'high', category: 'architecture', title: 'App Router routes marked force-dynamic, disabling all caching',
    evidenceFiles: ['src/app/[site]/[locale]/[[...path]]/page.tsx', 'src/pages/[[...path]].tsx'], evidence: [], tags: ['architecture', 'performance', 'caching'],
    note: 'force-dynamic is a footgun. Unless content is truly real-time, this should be changed to ISR or static.' },
  // Batch 3 (batchId bf80f88b — 4 findings)
  { id: 'ROUTING-NO-CMS-RESOLUTION', severity: 'high', category: 'routing', title: "Dynamic routes don't resolve paths through Layout Service",
    evidenceFiles: ['src/pages/[[...path]].tsx', 'src/app/[site]/[locale]/[[...path]]/page.tsx'], evidence: [], tags: ['routing', 'cms-integration', 'data-fetching'],
    note: "Skeleton doesn't implement path resolution. 404 logic missing — add a static page and it will 200 everything." },
  { id: 'DEPLOY-CONFIG-MISSING', severity: 'medium', category: 'deployment', title: 'No deployment configuration or environment strategy',
    evidenceFiles: ['package.json'], evidence: [], tags: ['deployment', 'configuration', 'devops'],
    note: 'Missing: Dockerfile, .dockerignore, env override strategy, Vercel/Azure deployment config.' },
  { id: 'ARCH-NO-TESTS', severity: 'medium', category: 'architecture', title: 'Zero test infrastructure; no unit, integration, or e2e tests',
    evidenceFiles: ['package.json'], evidence: [], tags: ['architecture', 'testing', 'quality'],
    note: 'Add Jest or Vitest with React Testing Library. At minimum, add integration tests for editing endpoints.' },
  { id: 'STACK-TYPESCRIPT-GOOD', severity: 'info', category: 'stack', title: 'TypeScript strict mode properly configured',
    evidenceFiles: ['tsconfig.json', 'tsconfig.json', 'tsconfig.json'], evidence: [], tags: ['typescript', 'configuration'],
    note: 'Green finding — TypeScript setup is correct and will help catch errors.' },
];

export const SAMPLE_SCORECARD: Scorecard = {
  repoName: 'sitecore-minimal',
  goalType: 'onboarding',
  generatedAt: '2026-04-02T18:30:45.000Z',
  overallScore: 'red',
  categories: [
    { category: 'stack', score: 'yellow', findings: SAMPLE_FINDINGS.filter(f => f.category === 'stack').map(f => f.id), summary: 'JSS outdated, TypeScript configured well' },
    { category: 'dependencies', score: 'yellow', findings: SAMPLE_FINDINGS.filter(f => f.category === 'dependencies').map(f => f.id), summary: 'Next.js and React behind latest major' },
    { category: 'cms-integration', score: 'red', findings: SAMPLE_FINDINGS.filter(f => f.category === 'cms-integration').map(f => f.id), summary: 'Hybrid router architecture, incomplete migration' },
    { category: 'preview-editing', score: 'red', findings: SAMPLE_FINDINGS.filter(f => f.category === 'preview-editing').map(f => f.id), summary: 'Editing integration non-functional' },
    { category: 'security', score: 'red', findings: SAMPLE_FINDINGS.filter(f => f.category === 'security').map(f => f.id), summary: 'Hardcoded API key, missing security headers' },
    { category: 'configuration', score: 'yellow', findings: SAMPLE_FINDINGS.filter(f => f.category === 'configuration').map(f => f.id), summary: 'Env vars documented but not explained' },
    { category: 'architecture', score: 'red', findings: SAMPLE_FINDINGS.filter(f => f.category === 'architecture').map(f => f.id), summary: 'force-dynamic everywhere, no tests' },
    { category: 'routing', score: 'red', findings: SAMPLE_FINDINGS.filter(f => f.category === 'routing').map(f => f.id), summary: 'No CMS path resolution' },
    { category: 'deployment', score: 'yellow', findings: SAMPLE_FINDINGS.filter(f => f.category === 'deployment').map(f => f.id), summary: 'No deployment configuration' },
  ],
  topRisks: [
    { id: 'SEC-HARDCODED-KEY', severity: 'critical', title: 'Potential hardcoded/redacted API key in middleware' },
    { id: 'PREVIEW-INCOMPLETE', severity: 'high', title: 'Editing/preview integration is incomplete and non-functional' },
    { id: 'ARCH-FORCE-DYNAMIC', severity: 'high', title: 'App Router routes marked force-dynamic, disabling all caching' },
  ],
};

export const SAMPLE_METRICS: RunMetrics = {
  startedAt: '2026-04-02T18:25:21.344Z',
  completedAt: '2026-04-02T18:30:45.000Z',
  durationMs: 324000,
  toolCalls: 50,
  models: {
    'us.anthropic.claude-sonnet-4-6': {
      bedrockModelId: 'us.anthropic.claude-sonnet-4-6',
      calls: 38,
      inputTokens: 142000,
      outputTokens: 18500,
      cachedTokens: 0,
      estimatedCostUsd: 0.62,
    },
    'us.anthropic.claude-haiku-4-5-20251001-v1:0': {
      bedrockModelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      calls: 12,
      inputTokens: 48000,
      outputTokens: 6200,
      cachedTokens: 0,
      estimatedCostUsd: 0.08,
    },
  },
  totalEstimatedCostUsd: 0.70,
};

export const SAMPLE_BRIEF_MARKDOWN = `## Executive Summary

This Sitecore JSS starter project has significant gaps across security, CMS integration, and architecture. The critical finding is a potential hardcoded API key in middleware. The editing/preview system is non-functional, routes disable all caching via \`force-dynamic\`, and the hybrid Pages + App Router architecture signals an incomplete migration.

**Recommended priority:** Fix the hardcoded key immediately, then consolidate to App Router, implement Layout Service integration, and add basic test coverage before any production deployment.

## Stack Overview

- **Framework:** Next.js 14 with Sitecore JSS 21.6.0
- **Language:** TypeScript (strict mode — good)
- **Router:** Hybrid Pages + App Router (needs consolidation)
- **Styling:** CSS Modules
- **Testing:** None

## Key Risks

1. **Hardcoded API key** — Middleware contains a redacted key marker that may indicate a live secret was committed
2. **No preview/editing** — Content editors have no way to preview draft content
3. **force-dynamic everywhere** — Disables ISR and static generation, making every page request hit the server
`;
