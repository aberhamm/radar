import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { RunResult } from '../../src/agent/runner.js';
import type { Scorecard, CategoryScore, ScoreLevel } from '../../src/types/output.js';

// Mock all external dependencies before importing module under test
vi.mock('../../src/agent/runner.js', () => ({
  runAgent: vi.fn(),
  runPreCompute: vi.fn().mockResolvedValue({}),
  writeOutputFiles: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/tools/repo/cloneRepo.js', () => ({
  cloneRepo: vi.fn(),
}));
vi.mock('../../src/tools/dependency/queryNpmVersions.js', () => ({
  queryNpmVersions: vi.fn().mockResolvedValue({ versions: { next: '15.0.0' }, fromCache: true, cacheAge: '5m' }),
  TRACKED_PACKAGES: ['next'],
}));
vi.mock('../../src/output/verboseFormatter.js', () => ({
  formatVerboseStep: vi.fn(),
}));
vi.mock('../../src/output/scorecard.js', () => ({
  computeScorecard: vi.fn(),
}));
vi.mock('../../src/output/brief.js', () => ({
  renderBrief: vi.fn().mockReturnValue('# Brief'),
}));
vi.mock('../../src/output/json.js', () => ({
  buildFullExport: vi.fn().mockReturnValue({}),
  serializeExport: vi.fn().mockReturnValue('{}'),
}));
vi.mock('../../src/output/goalBriefWriter.js', () => ({
  writeAllBriefs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/output/multiGoalSummary.js', () => ({
  renderMultiGoalSummary: vi.fn().mockReturnValue('# Summary'),
}));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { handleAnalyzeAll } from '../../src/commands/analyzeAll.js';
import { runAgent, runPreCompute } from '../../src/agent/runner.js';
import { computeScorecard } from '../../src/output/scorecard.js';
import { writeAllBriefs } from '../../src/output/goalBriefWriter.js';
import { queryNpmVersions } from '../../src/tools/dependency/queryNpmVersions.js';
import fs from 'node:fs';

const FIXTURE_REPO = path.resolve(__dirname, '..', 'fixtures', 'sitecore-minimal');

function makeCategory(overrides: Partial<CategoryScore> = {}): CategoryScore {
  return {
    category: 'stack',
    score: 'green' as ScoreLevel,
    findings: [],
    summary: 'OK',
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'onboarding',
    generatedAt: new Date().toISOString(),
    overallScore: 'green' as ScoreLevel,
    categories: [makeCategory()],
    topRisks: [],
    ...overrides,
  };
}

function makeRunResult(overrides: Record<string, unknown> = {}): RunResult {
  return {
    terminationReason: 'completed',
    scorecard: makeScorecard(),
    briefMarkdown: '# Brief',
    exportJson: '{}',
    outputPaths: [],
    metrics: {
      toolCalls: 30,
      durationMs: 5000,
      totalEstimatedCostUsd: 0.10,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      models: {},
    },
    state: {
      goal: 'onboarding' as any,
      repo: { source: 'local' as const, localPath: FIXTURE_REPO, name: 'test' },
      stackProfile: {
        projectType: 'unknown', projectTypeConfidence: 'low',
        framework: { name: 'Next.js', version: '14.2.3', routerType: 'app' },
        cms: { platform: '', sdkPackages: [], integrationStyle: '' },
        packageManager: 'npm', language: 'typescript', deploymentIndicators: [], monorepo: false,
      },
      findings: [
        { id: 'F-001', category: 'stack', severity: 'medium', title: 'Test', description: '', evidence: [], tags: [] },
        { id: 'F-002', category: 'nextjs', severity: 'medium', title: 'Next.js finding', description: '', evidence: [], tags: [] },
        { id: 'F-003', category: 'accessibility', severity: 'medium', title: 'A11y finding', description: '', evidence: [], tags: [] },
      ],
      filesRead: new Set<string>(['package.json']),
      fileReadCache: new Map(),
      resolvedVersions: {},
      fetchedDocs: [],
      investigationLog: [{ step: 1, action: 'test', reasoning: '', result: '' }],
      toolCallCount: 30,
      toolCallBudget: 70,
      webSearchCount: 0,
      webSearchBudget: 5,
      urlFetchCount: 0,
      urlFetchBudget: 3,
      docTokensUsed: 0,
      docTokenBudget: 50000,
      modelUsage: new Map(),
    },
    ...overrides,
  } as unknown as RunResult;
}

const baseOpts = {
  repo: FIXTURE_REPO,
  output: '/tmp/test-analyze-all',
  budget: '100',
};

describe('handleAnalyzeAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(queryNpmVersions).mockResolvedValue({ versions: { next: '15.0.0' }, fromCache: true, cacheAge: '5m' } as any);
    vi.mocked(runPreCompute).mockResolvedValue({
      appRoots: {
        roots: [{ path: '.', type: 'nextjs', hasPackageJson: true, framework: 'next', frameworkVersion: '14.2.3' }],
        isMonorepo: false,
      },
    } as any);
    vi.mocked(runAgent).mockResolvedValue(makeRunResult());
    vi.mocked(computeScorecard).mockReturnValue(makeScorecard());
    vi.mocked(writeAllBriefs).mockResolvedValue([
      { goal: 'onboarding' as any, sections: { project_overview: 'Test' } },
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Argument validation ---

  it('throws when --repo is missing', async () => {
    await expect(handleAnalyzeAll({ output: '/tmp', budget: '100' })).rejects.toThrow('--repo is required');
  });

  it('throws when budget is below 60', async () => {
    await expect(handleAnalyzeAll({ ...baseOpts, budget: '50' })).rejects.toThrow('Budget 50 is too low');
  });

  // --- Core failure ---

  it('returns 2 when core pass fails', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('API timeout'));

    const code = await handleAnalyzeAll(baseOpts);

    expect(code).toBe(2);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  // --- Specialist graceful degradation ---

  it('continues when specialist pass fails', async () => {
    // Core succeeds
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeRunResult())
      // Next.js specialist fails
      .mockRejectedValueOnce(new Error('Specialist timeout'))
      // Accessibility specialist succeeds
      .mockResolvedValueOnce(makeRunResult());

    const code = await handleAnalyzeAll(baseOpts);

    // Should not return 2 (fatal) — specialists are non-fatal
    expect(code).toBeLessThan(2);
    expect(runAgent).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Specialist timeout'),
    );
  });

  // --- Exit codes ---

  it('returns 0 when all scorecards are green', async () => {
    vi.mocked(computeScorecard).mockReturnValue(makeScorecard({ overallScore: 'green' }));

    const code = await handleAnalyzeAll(baseOpts);
    expect(code).toBe(0);
  });

  it('returns 1 when any scorecard is red', async () => {
    let callCount = 0;
    vi.mocked(computeScorecard).mockImplementation(() => {
      callCount++;
      return makeScorecard({
        overallScore: callCount === 3 ? 'red' : 'green',
      });
    });

    const code = await handleAnalyzeAll(baseOpts);
    expect(code).toBe(1);
  });

  // --- Budget allocation ---

  it('allocates budget across passes based on detected frameworks', async () => {
    await handleAnalyzeAll({ ...baseOpts, budget: '100' });

    // 3 runAgent calls: core + nextjs + a11y (budget planner decides split)
    expect(runAgent).toHaveBeenCalledTimes(3);

    const calls = vi.mocked(runAgent).mock.calls;
    const coreBudget = calls[0][0].toolCallBudget!;
    const nextjsBudget = calls[1][0].toolCallBudget!;
    const a11yBudget = calls[2][0].toolCallBudget!;
    // All budgets should sum to total
    expect(coreBudget + nextjsBudget + a11yBudget).toBe(100);
    // Core should get the majority
    expect(coreBudget).toBeGreaterThan(nextjsBudget);
    expect(coreBudget).toBeGreaterThan(a11yBudget);
  });

  it('core pass uses universal goal', async () => {
    await handleAnalyzeAll(baseOpts);

    const coreCall = vi.mocked(runAgent).mock.calls[0][0];
    expect(coreCall.goal).toBe('universal');
  });

  it('specialist passes use correct goals', async () => {
    await handleAnalyzeAll(baseOpts);

    const calls = vi.mocked(runAgent).mock.calls;
    expect(calls[1][0].goal).toBe('nextjs');
    expect(calls[2][0].goal).toBe('accessibility');
  });

  it('passes shared state from core to specialists', async () => {
    await handleAnalyzeAll(baseOpts);

    const calls = vi.mocked(runAgent).mock.calls;
    // Second call (Next.js) should have initialState from core result
    expect(calls[1][0].initialState).toBeDefined();
    expect(calls[1][0].initialState?.findings).toBeDefined();
    // Third call (a11y) should have initialState from Next.js result
    expect(calls[2][0].initialState).toBeDefined();
  });

  // --- Multi-goal scoring ---

  it('scores all 8 goals from shared findings pool', async () => {
    await handleAnalyzeAll(baseOpts);

    // computeScorecard should be called once per goal (8 goals)
    expect(computeScorecard).toHaveBeenCalledTimes(8);
  });

  // --- JSON output mode ---

  it('outputs valid JSON in --json mode', async () => {
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((msg: string) => { logs.push(String(msg)); });

    const code = await handleAnalyzeAll({ ...baseOpts, json: true });

    expect(code).toBe(0);
    const jsonOutput = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.status).toBe('completed');
    expect(parsed.mode).toBe('universal');
    expect(parsed.goals).toHaveLength(8);
  });

  it('JSON mode returns 1 when any goal is red', async () => {
    let callCount = 0;
    vi.mocked(computeScorecard).mockImplementation(() => {
      callCount++;
      return makeScorecard({ overallScore: callCount === 1 ? 'red' : 'green' });
    });

    const code = await handleAnalyzeAll({ ...baseOpts, json: true });
    expect(code).toBe(1);
  });
});
