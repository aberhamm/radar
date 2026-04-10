import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mergeState } from '../../src/agent/runner.js';
import type { AgentState, ModelUsageEntry } from '../../src/types/state.js';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sitecore-minimal');

function makeState(overrides?: Partial<AgentState>): AgentState {
  return {
    goal: 'onboarding',
    repo: { source: 'local', localPath: FIXTURE_PATH, name: 'test' },
    resolvedVersions: {},
    findings: [],
    filesRead: new Set<string>(),
    fileReadCache: new Map(),
    toolCallCount: 0,
    toolCallBudget: 45,
    webSearchCount: 0,
    webSearchBudget: 5,
    urlFetchCount: 0,
    urlFetchBudget: 3,
    docTokensUsed: 0,
    docTokenBudget: 50000,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
    ...overrides,
  };
}

describe('mergeState', () => {
  it('merges all carry-over fields from source into target', () => {
    const target = makeState();
    const source: Partial<AgentState> = {
      findings: [
        { id: 'F-001', category: 'stack', severity: 'medium', title: 'Test finding', description: 'desc', evidence: [], tags: [] },
      ],
      filesRead: new Set(['package.json', 'tsconfig.json']),
      fileReadCache: new Map([['package.json', { mtime: 1000, contentHash: 'abc' }]]),
      resolvedVersions: { next: { package: 'next', latest: '15.0.0', latestMajor: 15, fetchedAt: '2026-01-01' } },
      stackProfile: {
        projectType: 'sitecore', projectTypeConfidence: 'high',
        framework: { name: 'next', version: '14.1.0', routerType: 'hybrid' },
        cms: { platform: 'sitecore', sdkPackages: [], integrationStyle: 'jss' },
        packageManager: 'npm', language: 'typescript', deploymentIndicators: [], monorepo: false,
      },
      fetchedDocs: [{ url: 'https://example.com', title: 'Doc', fetchedAt: '2026-01-01', tokenCount: 100, usedInFindings: [] }],
      modelUsage: new Map([['sonnet', { calls: 5, inputTokens: 1000, outputTokens: 500, cachedTokens: 0 }]]),
    };

    mergeState(target, source);

    expect(target.findings).toHaveLength(1);
    expect(target.findings[0].id).toBe('F-001');
    expect(target.filesRead.size).toBe(2);
    expect(target.filesRead.has('package.json')).toBe(true);
    expect(target.fileReadCache.size).toBe(1);
    expect(target.resolvedVersions.next?.latest).toBe('15.0.0');
    expect(target.stackProfile?.projectType).toBe('sitecore');
    expect(target.fetchedDocs).toHaveLength(1);
    expect(target.modelUsage.get('sonnet')?.calls).toBe(5);
  });

  it('does not touch target when source is empty', () => {
    const target = makeState({
      findings: [{ id: 'EXISTING', category: 'stack', severity: 'info', title: 'Existing', description: '', evidence: [], tags: [] }],
    });
    const source: Partial<AgentState> = {};

    mergeState(target, source);

    expect(target.findings).toHaveLength(1);
    expect(target.findings[0].id).toBe('EXISTING');
    expect(target.filesRead.size).toBe(0);
    expect(target.modelUsage.size).toBe(0);
  });

  it('rejects corrupt types gracefully — non-Array findings, non-Set filesRead, non-Map fileReadCache', () => {
    const target = makeState();
    const corrupt = {
      findings: 'not-an-array',
      filesRead: ['array-not-set'],
      fileReadCache: { key: 'object-not-map' },
      modelUsage: { key: 'object-not-map' },
    } as unknown as Partial<AgentState>;

    mergeState(target, corrupt);

    // Target should remain unchanged since types failed validation
    expect(target.findings).toHaveLength(0);
    expect(target.filesRead.size).toBe(0);
    expect(target.fileReadCache.size).toBe(0);
    expect(target.modelUsage.size).toBe(0);
  });

  it('accumulates modelUsage when target already has entries for the same model', () => {
    const target = makeState({
      modelUsage: new Map([
        ['sonnet', { calls: 3, inputTokens: 500, outputTokens: 200, cachedTokens: 50 }],
      ]),
    });
    const source: Partial<AgentState> = {
      modelUsage: new Map([
        ['sonnet', { calls: 2, inputTokens: 300, outputTokens: 100, cachedTokens: 0 }],
        ['haiku', { calls: 1, inputTokens: 100, outputTokens: 50, cachedTokens: 0 }],
      ]),
    };

    mergeState(target, source);

    const sonnet = target.modelUsage.get('sonnet')!;
    expect(sonnet.calls).toBe(5);
    expect(sonnet.inputTokens).toBe(800);
    expect(sonnet.outputTokens).toBe(300);
    expect(sonnet.cachedTokens).toBe(50);

    const haiku = target.modelUsage.get('haiku')!;
    expect(haiku.calls).toBe(1);
    expect(haiku.inputTokens).toBe(100);
  });

  it('deep-copies findings so source mutations do not affect target', () => {
    const sourceFindings = [
      { id: 'F-001', category: 'stack' as const, severity: 'high' as const, title: 'Original', description: '', evidence: [], tags: [] },
    ];
    const target = makeState();
    mergeState(target, { findings: sourceFindings });

    // Mutate source array
    sourceFindings.push({ id: 'F-002', category: 'security' as const, severity: 'low' as const, title: 'New', description: '', evidence: [], tags: [] });

    expect(target.findings).toHaveLength(1);
    expect(target.findings[0].id).toBe('F-001');
  });

  it('does not carry over toolCallCount, toolCallBudget, or investigationLog', () => {
    const target = makeState({ toolCallCount: 0, toolCallBudget: 45, investigationLog: [] });
    const source: Partial<AgentState> = {
      toolCallCount: 30,
      toolCallBudget: 100,
      investigationLog: [{ step: 1, action: 'test', reasoning: 'test', result: 'test' }],
      findings: [{ id: 'F-001', category: 'stack', severity: 'info', title: 'Test', description: '', evidence: [], tags: [] }],
    };

    mergeState(target, source);

    // Only findings should carry — budget/counter/log fields are not touched by mergeState
    expect(target.findings).toHaveLength(1);
    expect(target.toolCallCount).toBe(0);
    expect(target.toolCallBudget).toBe(45);
    expect(target.investigationLog).toHaveLength(0);
  });
});
