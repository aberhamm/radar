import { describe, it, expect } from 'vitest';
import { buildFullExport, serializeExport } from '../../src/output/json.js';
import type { AgentState } from '../../src/types/state.js';
import type { Scorecard, RunMetrics } from '../../src/types/output.js';

function makeMinimalState(overrides?: Partial<AgentState>): AgentState {
  return {
    goal: 'onboarding',
    repo: { source: 'local', localPath: '/tmp/test', name: 'test-repo' },
    resolvedVersions: {},
    findings: [],
    filesRead: new Set(),
    toolCallCount: 17,
    toolCallBudget: 45,
    webSearchCount: 0,
    webSearchBudget: 0,
    urlFetchCount: 0,
    urlFetchBudget: 0,
    docTokensUsed: 0,
    docTokenBudget: 0,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
    fileReadCache: new Map(),
    ...overrides,
  };
}

function makeMinimalScorecard(): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'onboarding',
    overallScore: 'green',
    categories: [],
    topRisks: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeMinimalMetrics(): RunMetrics {
  return {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    durationMs: 60000,
    toolCalls: 17,
    models: {},
    totalEstimatedCostUsd: 0.05,
  };
}

describe('buildFullExport', () => {
  it('populates terminationReason, toolCallsUsed, toolCallBudget in metadata', () => {
    const state = makeMinimalState({ toolCallCount: 23 });
    const result = buildFullExport(
      state,
      makeMinimalScorecard(),
      { summary: 'Test summary' },
      makeMinimalMetrics(),
      'completed',
      45,
    );

    expect(result.metadata.terminationReason).toBe('completed');
    expect(result.metadata.toolCallsUsed).toBe(23);
    expect(result.metadata.toolCallBudget).toBe(45);
  });

  it('leaves metadata fields undefined when not provided', () => {
    const state = makeMinimalState({ toolCallCount: 0 });
    const result = buildFullExport(
      state,
      makeMinimalScorecard(),
      {},
      makeMinimalMetrics(),
    );

    expect(result.metadata.terminationReason).toBeUndefined();
    expect(result.metadata.toolCallsUsed).toBe(0);
    expect(result.metadata.toolCallBudget).toBeUndefined();
  });

  it('includes metadata fields in serialized JSON output', () => {
    const state = makeMinimalState({ toolCallCount: 30 });
    const exportData = buildFullExport(
      state,
      makeMinimalScorecard(),
      { intro: 'Hello' },
      makeMinimalMetrics(),
      'budget_exhausted',
      50,
    );

    const json = serializeExport(exportData);
    const parsed = JSON.parse(json);

    expect(parsed.metadata.terminationReason).toBe('budget_exhausted');
    expect(parsed.metadata.toolCallsUsed).toBe(30);
    expect(parsed.metadata.toolCallBudget).toBe(50);
  });
});
