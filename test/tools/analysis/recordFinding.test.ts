import { describe, it, expect } from 'vitest';
import { recordFinding } from '../../../src/tools/analysis/recordFinding.js';
import type { AgentState } from '../../../src/types/state.js';
import type { Finding } from '../../../src/types/findings.js';

function makeState(): AgentState {
  return {
    goal: 'onboarding',
    repo: { source: 'local', localPath: '/tmp', name: 'test' },
    resolvedVersions: {},
    findings: [],
    filesRead: new Set(),
    toolCallCount: 0,
    toolCallBudget: 50,
    webSearchCount: 0,
    webSearchBudget: 5,
    urlFetchCount: 0,
    urlFetchBudget: 3,
    docTokensUsed: 0,
    docTokenBudget: 20000,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
  };
}

describe('recordFinding', () => {
  it('adds finding to state and returns count', () => {
    const state = makeState();
    const finding: Finding = {
      id: 'TEST-001',
      category: 'security',
      severity: 'high',
      title: 'Test finding',
      description: 'A test',
      evidence: [],
      tags: [],
    };
    const result = recordFinding(state, { finding });
    expect(result.findingId).toBe('TEST-001');
    expect(result.totalFindings).toBe(1);
    expect(state.findings).toHaveLength(1);
  });

  it('throws on missing required fields', () => {
    const state = makeState();
    expect(() =>
      recordFinding(state, { finding: { id: '', category: 'security', severity: 'high' } as Finding }),
    ).toThrow();
  });
});
