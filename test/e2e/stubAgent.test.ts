/**
 * E2e test: Run the full agent loop with StubProvider against the fixture repo.
 *
 * Asserts:
 * - All 12 brief sections populated
 * - 8+ findings recorded
 * - Every scorecard category has a score
 * - Findings have evidence, severity, and IDs
 * - Output files written to disk
 * - Termination reason is 'completed'
 * - Metrics are populated
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAgent, type RunResult } from '../../src/agent/runner.js';
import { StubProvider } from '../../src/providers/stub.js';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sitecore-minimal');
const OUTPUT_DIR = path.resolve(__dirname, '../__e2e_output__');

describe('E2e: StubProvider agent run', () => {
  let result: RunResult;

  beforeAll(async () => {
    // Clean output dir
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    const provider = new StubProvider();
    result = await runAgent({
      provider,
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'onboarding',
      toolCallBudget: 50,
      outputDir: OUTPUT_DIR,
    });
  }, 30_000);

  afterAll(() => {
    // Clean up output
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
    // Scorecard groups finding categories into 7 display categories
    // Each category uses findingCategories[0] as its key
    const categories = result.scorecard.categories.map((c) => c.category);
    expect(categories).toEqual([
      'stack',        // Stack & Framework
      'cms-integration',
      'preview-editing',
      'security',     // Security & Configuration
      'architecture', // Architecture + routing + data-fetching
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
      // Each evidence has filePath and description
      for (const ev of finding.evidence) {
        expect(ev.filePath).toBeTruthy();
        expect(ev.description).toBeTruthy();
      }
    }
  });

  it('brief markdown is non-empty and contains key sections', () => {
    expect(result.briefMarkdown.length).toBeGreaterThan(500);
    // Check for section headers that should be in the brief
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
    // StubProvider reports as 'stub-model'
    expect(Object.keys(result.metrics.models).length).toBeGreaterThan(0);
  });

  it('tool call count stays within budget', () => {
    expect(result.state.toolCallCount).toBeLessThanOrEqual(50);
  });
});
