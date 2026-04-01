/**
 * E2e test: Run the full Pi Agent loop with faux provider against the fixture repo.
 *
 * Uses Pi's built-in registerFauxProvider + fauxAssistantMessage/fauxToolCall
 * to script deterministic responses without hitting an LLM.
 *
 * Asserts:
 * - Termination reason is 'completed'
 * - 8+ findings recorded with required fields
 * - Every scorecard category has a score
 * - Brief markdown is substantive
 * - Output files written to disk
 * - Metrics are populated
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
const OUTPUT_DIR = path.resolve(__dirname, '../__e2e_output__');

/** Build the 8-step scripted response sequence as faux AssistantMessages. */
function buildFauxResponses() {
  return [
    // Step 1: List directory + parse package.json
    fauxAssistantMessage([
      fauxText('Investigating the project structure and stack.'),
      fauxToolCall('list_directory', { path: '.', depth: 2 }),
      fauxToolCall('parse_package_json', {}),
    ], { stopReason: 'toolUse' }),

    // Step 2: Read key files
    fauxAssistantMessage([
      fauxText('Reading key configuration files.'),
      fauxToolCall('read_file', { path: 'package.json' }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Check env and gitignore
    fauxAssistantMessage([
      fauxText('Checking security and environment configuration.'),
      fauxToolCall('check_gitignore', { patterns: ['.env', '.env.local', 'node_modules'] }),
      fauxToolCall('analyze_env_usage', { repoPath: '.' }),
    ], { stopReason: 'toolUse' }),

    // Step 4: Analyze components
    fauxAssistantMessage([
      fauxText('Analyzing component architecture and routing.'),
      fauxToolCall('analyze_component_directives', { path: 'src' }),
      fauxToolCall('analyze_route_structure', { repoPath: '.' }),
    ], { stopReason: 'toolUse' }),

    // Step 5: Record findings (stack, CMS)
    fauxAssistantMessage([
      fauxText('Recording findings for stack and CMS categories.'),
      fauxToolCall('record_finding', {
        finding: { id: 'STACK-001', category: 'stack', severity: 'info', title: 'Next.js application with standard configuration', description: 'The project uses Next.js with standard App Router configuration.', evidence: [{ filePath: 'package.json', description: 'Next.js detected in dependencies' }], tags: ['nextjs', 'stack'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'CMS-001', category: 'cms-integration', severity: 'info', title: 'CMS integration uses standard SDK patterns', description: 'CMS integration follows the recommended SDK approach.', evidence: [{ filePath: 'src/lib/client.ts', description: 'Standard CMS client setup' }], tags: ['cms'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 6: Record findings (editing, security, architecture)
    fauxAssistantMessage([
      fauxText('Recording findings for editing, security, and architecture.'),
      fauxToolCall('record_finding', {
        finding: { id: 'EDIT-001', category: 'preview-editing', severity: 'info', title: 'Preview mode uses Draft Mode pattern', description: 'Preview/editing uses Next.js Draft Mode correctly.', evidence: [{ filePath: 'src/app/api/editing/route.ts', description: 'Draft Mode integration' }], tags: ['editing'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'SEC-001', category: 'security', severity: 'medium', title: 'Environment variables not documented', description: 'No .env.example file found.', evidence: [{ filePath: '.gitignore', description: '.env gitignored but no example' }], tags: ['security', 'config'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'ARCH-001', category: 'architecture', severity: 'info', title: 'App Router with catch-all route pattern', description: 'Uses App Router with a catch-all route for CMS-driven pages.', evidence: [{ filePath: 'src/app/[[...path]]/page.tsx', description: 'Catch-all route' }], tags: ['routing'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 7: Record findings (dependencies, deployment, config)
    fauxAssistantMessage([
      fauxText('Recording findings for dependencies, deployment, and config.'),
      fauxToolCall('record_finding', {
        finding: { id: 'DEP-001', category: 'dependencies', severity: 'low', title: 'Dependencies are reasonably current', description: 'No critical version gaps detected.', evidence: [{ filePath: 'package.json', description: 'Version check' }], tags: ['dependencies'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'DEPLOY-001', category: 'deployment', severity: 'info', title: 'Deployment target appears to be Vercel', description: 'Vercel-specific configuration detected.', evidence: [{ filePath: 'next.config.ts', description: 'Vercel hints' }], tags: ['deployment'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'CONFIG-001', category: 'configuration', severity: 'info', title: 'TypeScript strict mode enabled', description: 'TypeScript strict mode is enabled.', evidence: [{ filePath: 'tsconfig.json', description: 'strict: true' }], tags: ['config'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 8: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling the onboarding brief.'),
      fauxToolCall('assemble_output', {
        sections: {
          project_overview: 'This is a Next.js headless CMS application built on the App Router.',
          stack_and_architecture: 'Next.js 15 with TypeScript, using the CMS SDK for content delivery.',
          key_files_table: '| Path | Purpose | Why It Matters |\n|---|---|---|\n| package.json | Dependencies | Core stack definition |',
          cms_integration: 'Content is fetched via the CMS SDK client.',
          preview_editing: 'Uses Next.js Draft Mode for preview.',
          environment_and_configuration: 'Required: CMS_URL, CMS_API_KEY, EDITING_SECRET.',
          local_setup_steps: '1. Clone\n2. npm install\n3. npm run dev',
          architecture_scorecard: 'Overall GREEN. All 7 categories assessed.',
          top_5_risks: '1. Missing .env documentation (medium)',
          first_week_reading: '1. README.md\n2. package.json\n3. src/app/[[...path]]/page.tsx',
          questions_for_client: '1. What is the production deployment target?',
          suggested_next_actions: '1. Create .env.example',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

describe('E2e: Pi Agent with faux provider', () => {
  let result: RunResult;
  let unregister: () => void;

  beforeAll(async () => {
    // Clean output dir
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    // Register faux provider with scripted responses
    const faux = registerFauxProvider();
    faux.setResponses(buildFauxResponses());
    unregister = faux.unregister;

    result = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'onboarding',
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
    expect(result.scorecard.repoName).toBe('sitecore-minimal');
  });

  it('scorecard has all 7 display categories', () => {
    const categories = result.scorecard.categories.map((c) => c.category);
    expect(categories).toEqual([
      'stack',
      'cms-integration',
      'preview-editing',
      'security',
      'architecture',
      'dependencies',
      'deployment',
    ]);
  });

  it('records 8+ findings', () => {
    expect(result.state.findings.length).toBeGreaterThanOrEqual(8);
  });

  it('every finding has required fields', () => {
    for (const finding of result.state.findings) {
      expect(finding.id).toBeTruthy();
      expect(finding.category).toBeTruthy();
      expect(finding.severity).toBeTruthy();
      expect(finding.title).toBeTruthy();
      expect(finding.description).toBeTruthy();
      expect(Array.isArray(finding.evidence)).toBe(true);
      expect(finding.evidence.length).toBeGreaterThan(0);
      for (const ev of finding.evidence) {
        expect(ev.filePath).toBeTruthy();
        expect(ev.description).toBeTruthy();
      }
    }
  });

  it('brief markdown is non-empty and contains key sections', () => {
    expect(result.briefMarkdown.length).toBeGreaterThan(500);
    expect(result.briefMarkdown).toContain('Scorecard');
  });

  it('export JSON is valid and contains expected structure', () => {
    const parsed = JSON.parse(result.exportJson);
    expect(parsed.scorecard).toBeDefined();
    expect(parsed.findings).toBeDefined();
    expect(parsed.metrics).toBeDefined();
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it('writes output files to disk', () => {
    expect(result.outputPaths.length).toBeGreaterThanOrEqual(4);
    for (const p of result.outputPaths) {
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('metrics are populated with usage data', () => {
    expect(result.metrics.toolCalls).toBeGreaterThan(0);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.startedAt).toBeTruthy();
    expect(result.metrics.completedAt).toBeTruthy();
    expect(Object.keys(result.metrics.models).length).toBeGreaterThan(0);
  });

  it('tool call count stays within budget', () => {
    expect(result.state.toolCallCount).toBeLessThanOrEqual(50);
  });
});
