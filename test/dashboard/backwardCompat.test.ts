/**
 * Backward compatibility regression tests for parentRunId schema addition.
 *
 * Verifies that existing single-goal runs are not broken by the new
 * parentRunId field on RunIndexEntry, RunEnvelope, and RunRecord.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  loadPersistedRuns,
  loadRunEnvelope,
  type RunRecord,
} from '../../dashboard/src/lib/agentSession.js';

describe('backward compatibility — parentRunId schema addition', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.__agentSession = undefined;
  });

  it('loads index.json without parentRunId field (pre-existing data)', () => {
    // Simulate an old index.json that has no parentRunId on any entry
    const oldIndex = [
      {
        id: 'old-run-1',
        goal: 'onboarding',
        repoName: 'legacy-repo',
        startedAt: '2026-03-01T00:00:00Z',
        completedAt: '2026-03-01T01:00:00Z',
        overallScore: 'green',
        findingsCount: 5,
        status: 'completed',
      },
      {
        id: 'old-run-2',
        goal: 'audit',
        repoName: 'legacy-repo',
        startedAt: '2026-03-02T00:00:00Z',
        status: 'completed',
      },
    ];

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(oldIndex));

    const runs = loadPersistedRuns();

    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe('old-run-1');
    expect(runs[0].parentRunId).toBeUndefined();
    expect(runs[1].parentRunId).toBeUndefined();
    expect(runs[0].goal).toBe('onboarding');
    expect(runs[0].overallScore).toBe('green');
  });

  it('loads mixed index with some entries having parentRunId and some without', () => {
    const mixedIndex = [
      {
        id: 'new-child-1',
        goal: 'audit',
        repoName: 'multi-repo',
        startedAt: '2026-04-11T00:00:00Z',
        parentRunId: 'parent-abc',
        status: 'completed',
      },
      {
        id: 'new-child-2',
        goal: 'onboarding',
        repoName: 'multi-repo',
        startedAt: '2026-04-11T00:00:00Z',
        parentRunId: 'parent-abc',
        status: 'completed',
      },
      {
        id: 'old-single',
        goal: 'security-review',
        repoName: 'single-repo',
        startedAt: '2026-04-10T00:00:00Z',
        status: 'completed',
      },
    ];

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mixedIndex));

    const runs = loadPersistedRuns();

    expect(runs).toHaveLength(3);

    // Multi-goal children have parentRunId
    expect(runs[0].parentRunId).toBe('parent-abc');
    expect(runs[1].parentRunId).toBe('parent-abc');

    // Single-goal entry has no parentRunId
    expect(runs[2].parentRunId).toBeUndefined();
    expect(runs[2].goal).toBe('security-review');
  });

  it('loadRunEnvelope returns envelope for single-goal run without parentRunId', () => {
    const envelope = {
      id: 'single-run',
      goal: 'onboarding',
      repoName: 'test-repo',
      startedAt: '2026-03-01T00:00:00Z',
      scorecard: { repoName: 'test-repo', goalType: 'onboarding', generatedAt: '', overallScore: 'green', categories: [], topRisks: [] },
      metrics: { startedAt: '', completedAt: '', durationMs: 1000, toolCalls: 10, models: {}, totalEstimatedCostUsd: 0.1 },
      briefMarkdown: '# Brief',
      terminationReason: 'completed',
      findingsSummary: [],
      // Note: no parentRunId field at all
    };

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(envelope));

    const record: RunRecord = {
      id: 'single-run',
      goal: 'onboarding',
      repoName: 'test-repo',
      startedAt: new Date('2026-03-01T00:00:00Z'),
      events: [],
      _dirPath: '/fake/output/runs/single-run',
    };

    const loaded = loadRunEnvelope(record);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('single-run');
    expect(loaded!.goal).toBe('onboarding');
    expect(loaded!.scorecard.overallScore).toBe('green');
    // parentRunId should be undefined (not present in old data)
    expect(loaded!.parentRunId).toBeUndefined();
  });

  it('loadRunEnvelope returns envelope with parentRunId for multi-goal child', () => {
    const envelope = {
      id: 'child-run',
      goal: 'audit',
      repoName: 'multi-repo',
      startedAt: '2026-04-11T00:00:00Z',
      scorecard: { repoName: 'multi-repo', goalType: 'audit', generatedAt: '', overallScore: 'yellow', categories: [], topRisks: [] },
      metrics: { startedAt: '', completedAt: '', durationMs: 2000, toolCalls: 20, models: {}, totalEstimatedCostUsd: 0.5 },
      briefMarkdown: '# Brief',
      terminationReason: 'completed',
      findingsSummary: [],
      parentRunId: 'parent-xyz',
    };

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(envelope));

    const record: RunRecord = {
      id: 'child-run',
      goal: 'audit',
      repoName: 'multi-repo',
      startedAt: new Date('2026-04-11T00:00:00Z'),
      events: [],
      parentRunId: 'parent-xyz',
      _dirPath: '/fake/output/runs/child-run',
    };

    const loaded = loadRunEnvelope(record);

    expect(loaded).not.toBeNull();
    expect(loaded!.parentRunId).toBe('parent-xyz');
  });
});
