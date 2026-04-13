/**
 * E2e test: Run the full Pi Agent loop with faux provider for the nextjs goal.
 *
 * Uses Pi's built-in registerFauxProvider + fauxAssistantMessage/fauxToolCall
 * to script deterministic responses without hitting an LLM.
 *
 * Asserts:
 * - Termination reason is 'completed'
 * - 8+ findings recorded with required fields
 * - Every nextjs scorecard category has a score
 * - Brief markdown is substantive
 * - Output files written to disk
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  fauxText,
} from '@mariozechner/pi-ai';
import { runAgent, type RunResult } from '../../src/agent/runner.js';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sitecore-minimal');
const OUTPUT_DIR = path.resolve(__dirname, '../__e2e_nextjs_output__');

function buildFauxResponses() {
  return [
    // Step 1: List directory + parse package.json
    fauxAssistantMessage([
      fauxText('Investigating the project structure for Next.js audit.'),
      fauxToolCall('list_directory', { path: '.', depth: 2 }),
      fauxToolCall('parse_package_json', {}),
    ], { stopReason: 'toolUse' }),

    // Step 2: Read key config files
    fauxAssistantMessage([
      fauxText('Reading Next.js configuration and key files.'),
      fauxToolCall('read_file', { path: 'package.json' }),
      fauxToolCall('read_file', { path: 'next.config.js' }),
      fauxToolCall('read_file', { path: 'tsconfig.json' }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Analyze routing and components
    fauxAssistantMessage([
      fauxText('Analyzing route structure and component patterns.'),
      fauxToolCall('analyze_route_structure', { repoPath: '.' }),
      fauxToolCall('analyze_component_directives', { path: 'src' }),
      fauxToolCall('read_files_batch', { paths: ['src/app/[site]/[locale]/[[...path]]/page.tsx', 'src/middleware.ts', 'src/components/ClientWidget.tsx', 'src/components/ServerCard.tsx'] }),
    ], { stopReason: 'toolUse' }),

    // Step 4: Record findings — router architecture, data fetching, rendering
    fauxAssistantMessage([
      fauxText('Recording findings for router, data fetching, and rendering.'),
      fauxToolCall('record_finding', {
        finding: { id: 'ROUTE-001', category: 'routing', severity: 'info', title: 'Hybrid App Router + Pages Router', description: 'Project uses both App Router (app/) and Pages Router (pages/), indicating partial migration.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', lineNumber: 3, snippet: "export const dynamic = 'force-dynamic';", description: 'App Router catch-all route' }], tags: ['routing'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'FETCH-001', category: 'data-fetching', severity: 'medium', title: 'Force-dynamic disables static optimization', description: 'All CMS-driven routes use force-dynamic, preventing ISR or SSG.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', lineNumber: 3, snippet: "export const dynamic = 'force-dynamic';", description: 'force-dynamic route segment config' }], tags: ['data-fetching', 'performance'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'RENDER-001', category: 'nextjs', severity: 'info', title: 'Server Components used by default', description: 'Components without use client directive render as Server Components.', evidence: [{ filePath: 'src/components/ServerCard.tsx', lineNumber: 6, snippet: 'export default function ServerCard({ title, description }: ServerCardProps) {', description: 'No use client — server component by default' }], tags: ['nextjs', 'rendering'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 5: Record findings — performance, config, deps, stack
    fauxAssistantMessage([
      fauxText('Recording findings for performance, config, dependencies, and stack.'),
      fauxToolCall('record_finding', {
        finding: { id: 'PERF-001', category: 'performance', severity: 'medium', title: 'No next/image usage detected', description: 'Components do not use next/image for image optimization.', evidence: [{ filePath: 'src/components/ServerCard.tsx', lineNumber: 6, snippet: 'export default function ServerCard({ title, description }: ServerCardProps) {', description: 'Component does not import next/image' }], tags: ['performance', 'images'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'CONFIG-001', category: 'configuration', severity: 'medium', title: 'No security headers configured', description: 'next.config.js lacks security headers (CSP, HSTS, X-Frame-Options).', evidence: [{ filePath: 'next.config.js', lineNumber: 16, snippet: 'module.exports = withSitecoreConfig(nextConfig);', description: 'No headers() in next.config.js' }], tags: ['configuration', 'security'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'DEP-001', category: 'dependencies', severity: 'high', title: 'Next.js 14.1 is one major version behind', description: 'Next.js 15 is available with significant improvements.', evidence: [{ filePath: 'package.json', lineNumber: 15, snippet: '"next": "14.1.0"', description: 'Next.js version in dependencies' }], tags: ['dependencies', 'nextjs'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'STACK-001', category: 'stack', severity: 'info', title: 'TypeScript strict mode enabled', description: 'TypeScript is configured with strict mode.', evidence: [{ filePath: 'tsconfig.json', lineNumber: 7, snippet: '"strict": true', description: 'Strict mode in tsconfig' }], tags: ['stack', 'typescript'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'ARCH-001', category: 'architecture', severity: 'info', title: 'Clean component separation', description: 'Client and server components are properly separated with use client directives.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', lineNumber: 1, snippet: "'use client';", description: 'Explicit client directive' }], tags: ['architecture'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'ROUTE-002', category: 'routing', severity: 'medium', title: 'Pages Router still active alongside App Router', description: 'Legacy pages/ directory contains routes that should be migrated to app/.', evidence: [{ filePath: 'package.json', lineNumber: 15, snippet: '"next": "14.1.0"', description: 'Next.js 14 supports full App Router' }], tags: ['routing', 'migration'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 6: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling the Next.js audit brief.'),
      fauxToolCall('assemble_output', {
        sections: {
          executive_summary: 'This Next.js 14.1 project uses a hybrid App/Pages Router with TypeScript strict mode enabled.',
          router_architecture: 'The project uses both App Router and Pages Router, indicating an in-progress migration from Pages to App Router.',
          data_fetching_analysis: 'All CMS-driven routes use force-dynamic, which prevents static optimization and ISR.',
          performance_assessment: 'No next/image usage detected. All routes are server-rendered dynamically.',
          configuration_review: 'next.config.js is wrapped with Sitecore config but lacks security headers.',
          upgrade_path: 'Next.js 15 upgrade recommended. Key breaking change: async request APIs.',
          recommendations: '1. Complete App Router migration\n2. Add security headers\n3. Adopt next/image for optimization',
          architecture_scorecard: 'Overall YELLOW. Framework patterns are sound but missing optimizations.',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

describe('E2e: Pi Agent nextjs goal', () => {
  let result: RunResult;
  let unregister: () => void;

  beforeAll(async () => {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    const faux = registerFauxProvider();
    faux.setResponses(buildFauxResponses());
    unregister = faux.unregister;

    result = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'nextjs',
      toolCallBudget: 50,
      outputDir: OUTPUT_DIR,
      model: faux.getModel(),
    });
  }, 30_000);

  afterAll(() => {
    unregister();
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it('terminates with completed status', () => {
    expect(result.terminationReason).toBe('completed');
    expect(result.errorDetail).toBeUndefined();
  });

  it('produces a scorecard with overall score', () => {
    expect(result.scorecard).toBeDefined();
    expect(['red', 'yellow', 'green']).toContain(result.scorecard.overallScore);
  });

  it('scorecard has all 7 nextjs display categories', () => {
    expect(result.scorecard.categories.length).toBe(7);
    const primaryCategories = result.scorecard.categories.map((c) => c.category);
    expect(primaryCategories).toContain('Router Architecture');
    expect(primaryCategories).toContain('Data Fetching');
    expect(primaryCategories).toContain('Performance');
    expect(primaryCategories).toContain('Configuration');
    expect(primaryCategories).toContain('Dependencies');
  });

  it('records 8+ findings', () => {
    expect(result.state.findings.length).toBeGreaterThanOrEqual(8);
  });

  it('every finding has required fields', () => {
    for (const finding of result.state.findings) {
      expect(finding.id, `finding ${finding.id} missing id`).toBeTruthy();
      expect(finding.category, `finding ${finding.id} missing category`).toBeTruthy();
      expect(finding.severity, `finding ${finding.id} missing severity`).toBeTruthy();
      expect(finding.title, `finding ${finding.id} missing title`).toBeTruthy();
      expect(finding.description, `finding ${finding.id} missing description`).toBeTruthy();
      expect(Array.isArray(finding.evidence), `finding ${finding.id} evidence not array`).toBe(true);
      expect(finding.evidence.length, `finding ${finding.id} has no evidence`).toBeGreaterThan(0);
    }
  });

  it('brief markdown is non-empty', () => {
    expect(result.briefMarkdown.length).toBeGreaterThan(200);
  });

  it('writes output files to disk', () => {
    expect(result.outputPaths.length).toBeGreaterThanOrEqual(4);
    for (const p of result.outputPaths) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('goal type is nextjs in scorecard', () => {
    expect(result.scorecard.goalType).toBe('nextjs');
  });
});
