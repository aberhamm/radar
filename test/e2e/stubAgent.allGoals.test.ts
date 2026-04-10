/**
 * E2e test: Run 3 tiered passes (core + Next.js + a11y) with faux providers,
 * carry state between passes, then score all 8 goals from the accumulated findings.
 *
 * Asserts:
 * - All 3 passes complete successfully
 * - Findings accumulate across passes via initialState
 * - computeScorecard produces valid scores for all 8 goals
 * - Each pass's scorecard is valid
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  fauxText,
} from '@mariozechner/pi-ai';
import { runAgent, type RunResult } from '../../src/agent/runner.js';
import { computeScorecard } from '../../src/output/scorecard.js';
import type { AgentState, GoalType } from '../../src/types/state.js';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sitecore-minimal');
const OUTPUT_DIR = path.resolve(__dirname, '../__e2e_allgoals_output__');

const ALL_GOALS: GoalType[] = [
  'onboarding', 'audit', 'migration', 'component-map',
  'ci-check', 'security-review', 'nextjs', 'accessibility',
];

/** Core investigation responses: read files, record 9 findings (one per core category), assemble. */
function buildCoreResponses() {
  return [
    // Step 1: Read config files
    fauxAssistantMessage([
      fauxText('Investigating project structure and stack.'),
      fauxToolCall('read_file', { path: 'package.json' }),
      fauxToolCall('read_file', { path: 'next.config.js' }),
      fauxToolCall('read_file', { path: 'tsconfig.json' }),
    ], { stopReason: 'toolUse' }),

    // Step 2: Read source files for evidence
    fauxAssistantMessage([
      fauxText('Reading source files for evidence.'),
      fauxToolCall('read_file', { path: '.env.example' }),
      fauxToolCall('read_file', { path: 'src/middleware.ts' }),
      fauxToolCall('read_file', { path: 'src/components/ClientWidget.tsx' }),
      fauxToolCall('read_file', { path: 'src/components/ServerCard.tsx' }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Record core findings (batch 1)
    fauxAssistantMessage([
      fauxText('Recording core findings.'),
      fauxToolCall('record_finding', {
        finding: { id: 'STACK-001', category: 'stack', severity: 'info', title: 'Next.js 14 with TypeScript strict', description: 'Project uses Next.js 14.1.0 with TypeScript strict mode enabled.', evidence: [{ filePath: 'package.json', snippet: '"next": "14.1.0"', description: 'Next.js version' }], tags: ['stack'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'CMS-001', category: 'cms-integration', severity: 'info', title: 'Sitecore JSS SDK integration', description: 'Uses @sitecore-jss/sitecore-jss-nextjs for CMS integration.', evidence: [{ filePath: 'package.json', snippet: '@sitecore-jss/sitecore-jss-nextjs', description: 'JSS SDK dependency' }], tags: ['cms'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'SEC-001', category: 'security', severity: 'medium', title: 'API key placeholder in env example', description: 'Environment example file contains placeholder API keys.', evidence: [{ filePath: '.env.example', snippet: 'SITECORE_API_KEY=', description: 'API key placeholder' }], tags: ['security'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'CONFIG-001', category: 'configuration', severity: 'medium', title: 'No security headers in next.config', description: 'next.config.js does not configure security headers.', evidence: [{ filePath: 'next.config.js', snippet: 'module.exports = withSitecoreConfig(nextConfig)', description: 'No headers() config' }], tags: ['configuration'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'DEPS-001', category: 'dependencies', severity: 'high', title: 'Next.js 14 one major behind', description: 'Next.js 15 is available with significant improvements.', evidence: [{ filePath: 'package.json', snippet: '"next": "14.1.0"', description: 'Current version' }], tags: ['dependencies'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 4: Record core findings (batch 2)
    fauxAssistantMessage([
      fauxText('Recording remaining core findings.'),
      fauxToolCall('record_finding', {
        finding: { id: 'ARCH-001', category: 'architecture', severity: 'info', title: 'Hybrid App + Pages Router', description: 'Project uses both App Router and Pages Router, indicating partial migration.', evidence: [{ filePath: 'src/middleware.ts', snippet: 'export { middleware }', description: 'Middleware bridges both routers' }], tags: ['architecture'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'PREV-001', category: 'preview-editing', severity: 'medium', title: 'Legacy editing endpoint', description: 'Uses Pages Router API route for editing render.', evidence: [{ filePath: 'package.json', snippet: '"next": "14.1.0"', description: 'Pages Router editing API' }], tags: ['preview'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'DEPLOY-001', category: 'deployment', severity: 'info', title: 'Standard Next.js deployment', description: 'Project uses standard Next.js build with Sitecore config wrapper.', evidence: [{ filePath: 'next.config.js', snippet: 'module.exports = withSitecoreConfig(nextConfig)', description: 'Build config' }], tags: ['deployment'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'NJS-001', category: 'nextjs', severity: 'medium', title: 'Force-dynamic disables static optimization', description: 'CMS routes use force-dynamic, preventing ISR and SSG.', evidence: [{ filePath: 'package.json', snippet: '"next": "14.1.0"', description: 'Next.js framework' }], tags: ['nextjs'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 5: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling core output.'),
      fauxToolCall('switch_to_fast_model', {}),
      fauxToolCall('assemble_output', {
        sections: {
          project_overview: 'A Sitecore JSS project built on Next.js 14.1.0 with TypeScript strict mode.',
          stack_and_architecture: 'Next.js 14 hybrid App/Pages Router with Sitecore JSS integration.',
          key_files: 'package.json, next.config.js, tsconfig.json, src/middleware.ts',
          cms_integration: 'Sitecore JSS SDK for headless CMS content delivery.',
          configuration_environment: 'Env example with placeholder API keys, no security headers.',
          next_actions: '1. Upgrade Next.js 2. Add security headers 3. Complete App Router migration',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

/** Next.js specialist responses: targeted investigation + 3 findings. */
function buildNextjsResponses() {
  return [
    // Step 1: Read route files
    fauxAssistantMessage([
      fauxText('Investigating Next.js routing and rendering patterns.'),
      fauxToolCall('read_file', { path: 'src/app/[site]/[locale]/[[...path]]/page.tsx' }),
    ], { stopReason: 'toolUse' }),

    // Step 2: Record specialist findings
    fauxAssistantMessage([
      fauxText('Recording Next.js specialist findings.'),
      fauxToolCall('record_finding', {
        finding: { id: 'ROUTE-001', category: 'routing', severity: 'info', title: 'Dynamic catch-all route', description: 'Uses [[...path]] catch-all for CMS-driven routing.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', snippet: 'export default async function Page', description: 'Catch-all route' }], tags: ['routing'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'FETCH-001', category: 'data-fetching', severity: 'medium', title: 'Server-side data fetching only', description: 'All data fetching happens server-side with no client-side caching.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', snippet: 'export default async function Page', description: 'Async server component' }], tags: ['data-fetching'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'PERF-001', category: 'performance', severity: 'medium', title: 'No next/image usage', description: 'Components do not use next/image for image optimization.', evidence: [{ filePath: 'src/components/ServerCard.tsx', snippet: 'export default function ServerCard', description: 'No next/image import' }], tags: ['performance'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling Next.js specialist output.'),
      fauxToolCall('switch_to_fast_model', {}),
      fauxToolCall('assemble_output', {
        sections: {
          executive_summary: 'Next.js routing uses dynamic catch-all with force-dynamic rendering.',
          router_architecture: 'Hybrid App/Pages Router with catch-all CMS routing.',
          data_fetching_analysis: 'All server-side, no caching or ISR.',
          performance_assessment: 'No next/image, no static optimization.',
          recommendations: 'Add ISR, adopt next/image, complete router migration.',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

/** Accessibility specialist responses: targeted investigation + 2 findings. */
function buildA11yResponses() {
  return [
    // Step 1: Read component files
    fauxAssistantMessage([
      fauxText('Investigating accessibility patterns in components.'),
      fauxToolCall('read_file', { path: 'src/components/ClientWidget.tsx' }),
      fauxToolCall('read_file', { path: 'src/components/ServerCard.tsx' }),
    ], { stopReason: 'toolUse' }),

    // Step 2: Record a11y findings
    fauxAssistantMessage([
      fauxText('Recording accessibility findings.'),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-001', category: 'accessibility', severity: 'medium', title: 'No ARIA landmarks in components', description: 'Components lack ARIA landmark roles for screen reader navigation.', evidence: [{ filePath: 'src/components/ServerCard.tsx', snippet: 'export default function ServerCard', description: 'No ARIA roles' }], tags: ['accessibility'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'FORMS-001', category: 'forms', severity: 'low', title: 'No form validation patterns detected', description: 'No form components with accessible error handling found.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', snippet: "'use client'", description: 'Interactive component without form handling' }], tags: ['forms'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling accessibility output.'),
      fauxToolCall('switch_to_fast_model', {}),
      fauxToolCall('assemble_output', {
        sections: {
          executive_summary: 'Components lack ARIA landmarks and accessible form patterns.',
          component_audit: 'ServerCard and ClientWidget need ARIA roles.',
          recommendations: 'Add landmark roles, implement accessible form patterns.',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

function extractSharedState(result: RunResult): Partial<AgentState> {
  return {
    findings: result.state.findings,
    filesRead: result.state.filesRead,
    fileReadCache: result.state.fileReadCache,
    resolvedVersions: result.state.resolvedVersions,
    stackProfile: result.state.stackProfile,
    fetchedDocs: result.state.fetchedDocs,
    modelUsage: result.state.modelUsage,
  };
}

describe('E2e: Universal analysis (3 tiered passes)', () => {
  afterAll(() => {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it('accumulates findings across 3 passes and scores all 8 goals', async () => {
    // Clean output dir
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    // --- Pass 1: Core investigation ---
    const faux1 = registerFauxProvider();
    faux1.setResponses(buildCoreResponses());
    const coreResult = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'audit',
      toolCallBudget: 50,
      outputDir: path.join(OUTPUT_DIR, 'core'),
      model: faux1.getModel(),
    });
    faux1.unregister();

    expect(coreResult.terminationReason).toBe('completed');
    const coreFindingCount = coreResult.state.findings.length;
    expect(coreFindingCount).toBeGreaterThanOrEqual(5);

    // --- Pass 2: Next.js specialist ---
    const faux2 = registerFauxProvider();
    faux2.setResponses(buildNextjsResponses());
    const nextjsResult = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'nextjs',
      toolCallBudget: 30,
      outputDir: path.join(OUTPUT_DIR, 'nextjs'),
      model: faux2.getModel(),
      initialState: extractSharedState(coreResult),
    });
    faux2.unregister();

    expect(nextjsResult.terminationReason).toBe('completed');
    // Specialist should have MORE findings than core (accumulated)
    expect(nextjsResult.state.findings.length).toBeGreaterThan(coreFindingCount);

    // --- Pass 3: Accessibility specialist ---
    const faux3 = registerFauxProvider();
    faux3.setResponses(buildA11yResponses());
    const a11yResult = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'accessibility',
      toolCallBudget: 30,
      outputDir: path.join(OUTPUT_DIR, 'a11y'),
      model: faux3.getModel(),
      initialState: extractSharedState(nextjsResult),
    });
    faux3.unregister();

    expect(a11yResult.terminationReason).toBe('completed');
    const allFindings = a11yResult.state.findings;
    expect(allFindings.length).toBeGreaterThan(nextjsResult.state.findings.length);

    // --- Multi-goal scoring ---
    // Score all 8 goals from the unified findings pool
    for (const goal of ALL_GOALS) {
      const scorecard = computeScorecard('sitecore-minimal', goal, allFindings);
      expect(scorecard.overallScore, `${goal} should have a valid score`).toMatch(/^(red|yellow|green)$/);
      expect(scorecard.categories.length, `${goal} should have scored categories`).toBeGreaterThan(0);
      for (const cat of scorecard.categories) {
        expect(['red', 'yellow', 'green'], `${goal}/${cat.category} invalid`).toContain(cat.score);
      }
    }

    // Verify finding categories span enough breadth for meaningful multi-goal scoring
    const categories = new Set(allFindings.map((f) => f.category));
    expect(categories.size).toBeGreaterThanOrEqual(8);

    // Verify filesRead accumulated across passes
    expect(a11yResult.state.filesRead.size).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
