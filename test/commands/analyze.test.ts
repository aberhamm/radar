import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// Mock all external dependencies before importing the module under test
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
vi.mock('../../src/output/githubHook.js', () => ({
  checkGhAuth: vi.fn().mockReturnValue({ authenticated: true, repoAccess: true }),
  postOnboardingIssue: vi.fn().mockReturnValue({ url: 'https://github.com/test/issue/1' }),
  postCiCheckComment: vi.fn().mockReturnValue({ url: 'https://github.com/test/pr/1#comment' }),
}));
vi.mock('../../src/output/verboseFormatter.js', () => ({
  formatVerboseStep: vi.fn(),
}));
vi.mock('../../src/agent/systemPrompt.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  listRuleFiles: vi.fn().mockReturnValue(['rule1.md', 'rule2.md']),
  validateRules: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/agent/goalPrompts.js', () => ({
  buildGoalPrompt: vi.fn().mockReturnValue('goal prompt'),
}));

import { handleAnalyze } from '../../src/commands/analyze.js';
import { runAgent } from '../../src/agent/runner.js';
import { queryNpmVersions } from '../../src/tools/dependency/queryNpmVersions.js';
import { checkGhAuth, postOnboardingIssue, postCiCheckComment } from '../../src/output/githubHook.js';
import { buildSystemPrompt, listRuleFiles, validateRules } from '../../src/agent/systemPrompt.js';
import { buildGoalPrompt } from '../../src/agent/goalPrompts.js';

const FIXTURE_REPO = path.resolve(__dirname, '..', 'fixtures', 'sitecore-minimal');

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    terminationReason: 'completed',
    scorecard: {
      overallScore: 'green',
      repoName: 'test-repo',
      goalType: 'onboarding',
      generatedAt: new Date().toISOString(),
      categories: [{ category: 'stack', score: 'green', findings: [], summary: 'ok' }],
      topRisks: [],
    },
    briefMarkdown: '# Brief\nTest brief content',
    exportJson: '{}',
    outputPaths: ['/tmp/brief.md'],
    metrics: {
      toolCalls: 10,
      durationMs: 5000,
      totalEstimatedCostUsd: 0.05,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      models: {
        'us.anthropic.claude-sonnet-4-6': {
          bedrockModelId: 'us.anthropic.claude-sonnet-4-6',
          calls: 10,
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 0,
          estimatedCostUsd: 0.05,
        },
      },
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

const baseOpts = {
  repo: FIXTURE_REPO,
  goal: 'onboarding',
  output: '/tmp/test-output',
  budget: '45',
};

describe('handleAnalyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mocks cleared by vi.clearAllMocks
    vi.mocked(queryNpmVersions).mockResolvedValue({ versions: { next: '14.0.0' }, fromCache: true, cacheAge: '5m' });
    vi.mocked(checkGhAuth).mockReturnValue({ authenticated: true, repoAccess: true } as any);
    vi.mocked(postOnboardingIssue).mockReturnValue({ url: 'https://github.com/test/issue/1' } as any);
    vi.mocked(postCiCheckComment).mockReturnValue({ url: 'https://github.com/test/pr/1#comment' } as any);
    vi.mocked(buildSystemPrompt).mockReturnValue('system prompt');
    vi.mocked(listRuleFiles).mockReturnValue(['rule1.md', 'rule2.md']);
    vi.mocked(validateRules).mockReturnValue([]);
    vi.mocked(buildGoalPrompt).mockReturnValue('goal prompt');
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Argument validation ---

  it('throws when --repo is missing', async () => {
    await expect(handleAnalyze({ output: '/tmp', budget: '45' })).rejects.toThrow('--repo is required');
  });

  it('throws on invalid goal', async () => {
    await expect(handleAnalyze({ ...baseOpts, goal: 'invalid-goal' })).rejects.toThrow('Invalid goal');
  });

  it('accepts nextjs goal', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    const code = await handleAnalyze({ ...baseOpts, goal: 'nextjs' });
    expect(code).toBe(0);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ goal: 'nextjs' }));
  });

  it('accepts accessibility goal', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    const code = await handleAnalyze({ ...baseOpts, goal: 'accessibility' });
    expect(code).toBe(0);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ goal: 'accessibility' }));
  });

  it('throws when local repo path does not exist', async () => {
    await expect(handleAnalyze({ ...baseOpts, repo: '/nonexistent/repo/path' })).rejects.toThrow('not found');
  });

  // --- Dry run ---

  it('returns 0 on dry run without calling runAgent', async () => {
    const code = await handleAnalyze({ ...baseOpts, dryRun: true });
    expect(code).toBe(0);
    expect(runAgent).not.toHaveBeenCalled();
  });

  // --- Exit codes ---

  it('returns 0 for green scorecard', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    const code = await handleAnalyze(baseOpts);
    expect(code).toBe(0);
  });

  it('returns 0 for yellow scorecard', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult({
      scorecard: { ...makeResult().scorecard, overallScore: 'yellow' },
    }) as any);
    const code = await handleAnalyze(baseOpts);
    expect(code).toBe(0);
  });

  it('returns 1 for red scorecard', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult({
      scorecard: { ...makeResult().scorecard, overallScore: 'red' },
    }) as any);
    const code = await handleAnalyze(baseOpts);
    expect(code).toBe(1);
  });

  it('returns 2 when terminationReason is error', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult({
      terminationReason: 'error',
      errorDetail: 'LLM connection failed',
    }) as any);
    const code = await handleAnalyze(baseOpts);
    expect(code).toBe(2);
  });

  // --- JSON output mode ---

  it('outputs valid JSON in --json mode', async () => {
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((msg: string) => { logs.push(msg); });
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);

    const code = await handleAnalyze({ ...baseOpts, json: true });
    expect(code).toBe(0);

    // Find the JSON output (last console.log with valid JSON)
    const jsonOutput = logs.find(l => { try { JSON.parse(l); return true; } catch { return false; } });
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.status).toBe('completed');
    expect(parsed.score).toBe('green');
    expect(parsed.findings).toBe(1);
    expect(parsed.toolCalls).toBe(10);
  });

  it('includes error field in JSON when terminationReason is error', async () => {
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((msg: string) => { logs.push(msg); });
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult({
      terminationReason: 'error',
      errorDetail: 'Something broke',
    }) as any);

    const code = await handleAnalyze({ ...baseOpts, json: true });
    expect(code).toBe(2);

    const jsonOutput = logs.find(l => { try { JSON.parse(l); return true; } catch { return false; } });
    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.error).toBe('Something broke');
  });

  // --- GitHub output ---

  it('calls postOnboardingIssue for onboarding goal with --githubOutput', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    await handleAnalyze({ ...baseOpts, goal: 'onboarding', githubOutput: true });
    expect(postOnboardingIssue).toHaveBeenCalledWith('sitecore-minimal', expect.any(String));
  });

  it('calls postCiCheckComment for ci-check goal with --githubOutput and --pr', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    await handleAnalyze({ ...baseOpts, goal: 'ci-check', githubOutput: true, pr: 42 });
    expect(postCiCheckComment).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('skips github output when auth fails', async () => {
    vi.mocked(checkGhAuth).mockReturnValueOnce({ authenticated: false, repoAccess: false, error: 'not logged in' } as any);
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    const code = await handleAnalyze({ ...baseOpts, githubOutput: true });
    expect(code).toBe(0);
    expect(postOnboardingIssue).not.toHaveBeenCalled();
  });

  // --- runAgent receives correct config ---

  it('passes correct config to runAgent', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeResult() as any);
    await handleAnalyze({ ...baseOpts, budget: '30', verbose: true });

    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: FIXTURE_REPO,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'onboarding',
      toolCallBudget: 30,
      verbose: true,
    }));
  });
});
