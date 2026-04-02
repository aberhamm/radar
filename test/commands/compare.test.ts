import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Mock external dependencies
vi.mock('../../src/agent/runner.js', () => ({
  runAgent: vi.fn(),
}));
vi.mock('../../src/tools/repo/cloneRepo.js', () => ({
  cloneRepo: vi.fn(),
}));
vi.mock('../../src/tools/dependency/queryNpmVersions.js', () => ({
  queryNpmVersions: vi.fn().mockResolvedValue({ versions: { next: '14.0.0' }, fromCache: true, cacheAge: '5m' }),
  TRACKED_PACKAGES: ['next'],
}));
vi.mock('../../src/output/verboseFormatter.js', () => ({
  formatVerboseStep: vi.fn(),
}));
vi.mock('../../src/output/comparisonRenderer.js', () => ({
  renderComparison: vi.fn().mockReturnValue('# Comparison\nMock comparison output'),
}));

import { handleCompare } from '../../src/commands/compare.js';
import { runAgent } from '../../src/agent/runner.js';
import { queryNpmVersions } from '../../src/tools/dependency/queryNpmVersions.js';
import { renderComparison } from '../../src/output/comparisonRenderer.js';

const FIXTURE_REPO = path.resolve(__dirname, '..', 'fixtures', 'sitecore-minimal');

function makeResult(repoName: string, overrides: Record<string, unknown> = {}) {
  return {
    terminationReason: 'completed',
    scorecard: {
      overallScore: 'green',
      repoName,
      goalType: 'onboarding',
      generatedAt: new Date().toISOString(),
      categories: [{ category: 'stack', score: 'green', findings: [], summary: 'ok' }],
      topRisks: [],
    },
    briefMarkdown: '# Brief\nTest',
    exportJson: '{}',
    outputPaths: ['/tmp/brief.md'],
    metrics: {
      toolCalls: 10,
      durationMs: 5000,
      totalEstimatedCostUsd: 0.05,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      models: {},
    },
    state: {
      findings: [{ id: 'F-001', category: 'stack', severity: 'medium', title: 'Test' }],
      toolCallCount: 10,
      toolCallBudget: 45,
      webSearchCount: 0,
      webSearchBudget: 5,
    },
    ...overrides,
  };
}

let tmpDir: string;

describe('handleCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mocks that vi.clearAllMocks may have cleared
    vi.mocked(queryNpmVersions).mockResolvedValue({ versions: { next: '14.0.0' }, fromCache: true, cacheAge: '5m' });
    vi.mocked(renderComparison).mockReturnValue('# Comparison\nMock comparison output');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseOpts = {
    repos: [FIXTURE_REPO, FIXTURE_REPO],
    goal: 'onboarding',
    output: '',
    budget: '45',
  };

  function opts(overrides: Record<string, unknown> = {}) {
    return { ...baseOpts, output: tmpDir, ...overrides };
  }

  // --- Argument validation ---

  it('throws when repos array has wrong count', async () => {
    await expect(handleCompare({ ...opts(), repos: [FIXTURE_REPO] })).rejects.toThrow('exactly two');
    await expect(handleCompare({ ...opts(), repos: [] })).rejects.toThrow('exactly two');
  });

  it('throws on invalid goal', async () => {
    await expect(handleCompare(opts({ goal: 'bad-goal' }))).rejects.toThrow('Invalid goal');
  });

  // --- Exit codes ---

  it('returns 0 when both repos are green', async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeResult('repo-a') as any)
      .mockResolvedValueOnce(makeResult('repo-b') as any);

    const code = await handleCompare(opts());
    expect(code).toBe(0);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it('returns 1 when one repo is red', async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeResult('repo-a', {
        scorecard: { ...makeResult('repo-a').scorecard, overallScore: 'red' },
      }) as any)
      .mockResolvedValueOnce(makeResult('repo-b') as any);

    const code = await handleCompare(opts());
    expect(code).toBe(1);
  });

  it('returns 2 when both repos fail', async () => {
    vi.mocked(runAgent)
      .mockRejectedValueOnce(new Error('Repo A broke'))
      .mockRejectedValueOnce(new Error('Repo B broke'));

    const code = await handleCompare(opts());
    expect(code).toBe(2);

    // Should still write a comparison file
    const outFile = path.join(tmpDir, 'comparison.md');
    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('Both repositories failed');
  });

  it('returns based on successful repo when one fails', async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeResult('repo-a') as any)
      .mockRejectedValueOnce(new Error('Repo B failed'));

    const code = await handleCompare(opts());
    expect(code).toBe(0); // repo-a is green

    const outFile = path.join(tmpDir, 'comparison.md');
    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('failed');
  });

  // --- Comparison output ---

  it('calls renderComparison when both succeed and writes output', async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeResult('repo-a') as any)
      .mockResolvedValueOnce(makeResult('repo-b') as any);

    await handleCompare(opts());

    expect(renderComparison).toHaveBeenCalled();
    const outFile = path.join(tmpDir, 'comparison.md');
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it('still runs repo-b even if repo-a throws', async () => {
    vi.mocked(runAgent)
      .mockRejectedValueOnce(new Error('Repo A broke'))
      .mockResolvedValueOnce(makeResult('repo-b') as any);

    const code = await handleCompare(opts());
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(code).toBe(0); // repo-b is green
  });

  // --- Config passed to runAgent ---

  it('passes correct config to runAgent for each repo', async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeResult('repo-a') as any)
      .mockResolvedValueOnce(makeResult('repo-b') as any);

    await handleCompare(opts({ budget: '30' }));

    expect(runAgent).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(runAgent).mock.calls) {
      const config = call[0] as any;
      expect(config.goal).toBe('onboarding');
      expect(config.toolCallBudget).toBe(30);
      expect(config.repoSource).toBe('local');
    }
  });
});
