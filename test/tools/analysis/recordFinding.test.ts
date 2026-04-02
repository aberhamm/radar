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
    // No id, category, or severity at any level
    expect(() =>
      recordFinding(state, { finding: { title: 'bad', description: 'no keys' } as unknown as Finding }),
    ).toThrow();
  });

  it('handles array of findings in a single call', () => {
    const state = makeState();
    // LLM sometimes passes an array instead of a single finding
    const batchInput = {
      finding: [
        { id: 'BATCH-001', category: 'security', severity: 'high', title: 'First', description: 'Desc', evidence: [], tags: [] },
        { id: 'BATCH-002', category: 'stack', severity: 'info', title: 'Second', description: 'Desc', evidence: [], tags: [] },
      ],
    };
    const result = recordFinding(state, batchInput as unknown as { finding: Finding });
    expect(result.findingId).toBe('BATCH-001, BATCH-002');
    expect(result.totalFindings).toBe(2);
    expect(result.recordedCount).toBe(2);
    expect(state.findings).toHaveLength(2);
  });

  it('handles numeric-keyed object (array serialized as object)', () => {
    const state = makeState();
    // When JSON.parse turns an array into an object with numeric keys
    const numericInput = {
      '0': { id: 'NUM-001', category: 'architecture', severity: 'medium', title: 'Arch', description: 'D', evidence: [], tags: [] },
      '1': { id: 'NUM-002', category: 'dependencies', severity: 'low', title: 'Dep', description: 'D', evidence: [], tags: [] },
    };
    const result = recordFinding(state, numericInput as unknown as { finding: Finding });
    expect(result.totalFindings).toBe(2);
    expect(state.findings).toHaveLength(2);
  });

  it('rejects finding with numeric severity', () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-001', category: 'security', severity: 42, title: 'Numeric sev', description: 'D', evidence: [], tags: [] },
    };
    expect(() => recordFinding(state, bad as unknown as { finding: Finding })).toThrow();
  });

  it('rejects finding with null category', () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-002', category: null, severity: 'high', title: 'Null cat', description: 'D', evidence: [], tags: [] },
    };
    expect(() => recordFinding(state, bad as unknown as { finding: Finding })).toThrow();
  });

  it('rejects finding with invalid severity string', () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-003', category: 'security', severity: 'urgent', title: 'Bad sev', description: 'D', evidence: [], tags: [] },
    };
    expect(() => recordFinding(state, bad as unknown as { finding: Finding })).toThrow();
  });

  it('rejects finding with invalid category string', () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-004', category: 'unknown-cat', severity: 'high', title: 'Bad cat', description: 'D', evidence: [], tags: [] },
    };
    expect(() => recordFinding(state, bad as unknown as { finding: Finding })).toThrow();
  });

  it('rejects finding with missing title', () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-005', category: 'security', severity: 'high', description: 'No title', evidence: [], tags: [] },
    };
    expect(() => recordFinding(state, bad as unknown as { finding: Finding })).toThrow();
  });
});
