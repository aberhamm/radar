import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  saveSessionCost,
  loadSessionCosts,
  buildSessionCostEntry,
  aggregateSessionCosts,
  type SessionCostEntry,
} from '../../src/output/sessionCosts.js';
import type { RunMetrics } from '../../src/types/output.js';

const tmpBase = path.join(os.tmpdir(), 'session-costs-test');

function makeEntry(overrides: Partial<SessionCostEntry> = {}): SessionCostEntry {
  return {
    runId: 'test-repo-2026-04-06T00:00:00.000Z',
    repoName: 'test-repo',
    goalType: 'onboarding',
    startedAt: '2026-04-06T00:00:00.000Z',
    completedAt: '2026-04-06T00:05:00.000Z',
    durationMs: 300_000,
    toolCalls: 35,
    totalEstimatedCostUsd: 0.74,
    models: {
      'us.anthropic.claude-sonnet-4-6': {
        bedrockModelId: 'us.anthropic.claude-sonnet-4-6',
        calls: 20,
        inputTokens: 50000,
        outputTokens: 10000,
        cachedTokens: 5000,
        estimatedCostUsd: 0.47,
      },
    },
    ...overrides,
  };
}

let testDir: string;

beforeEach(() => {
  testDir = path.join(tmpBase, `run-${Date.now()}`);
});

afterEach(() => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('sessionCosts', () => {
  it('saves and loads a single cost entry', () => {
    const entry = makeEntry();
    saveSessionCost(testDir, entry);
    const loaded = loadSessionCosts(testDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].repoName).toBe('test-repo');
    expect(loaded[0].totalEstimatedCostUsd).toBe(0.74);
  });

  it('appends multiple entries to the same file', () => {
    saveSessionCost(testDir, makeEntry({ repoName: 'repo-a', totalEstimatedCostUsd: 0.50 }));
    saveSessionCost(testDir, makeEntry({ repoName: 'repo-b', totalEstimatedCostUsd: 1.20 }));
    const loaded = loadSessionCosts(testDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].repoName).toBe('repo-a');
    expect(loaded[1].repoName).toBe('repo-b');
  });

  it('returns empty array when file does not exist', () => {
    const loaded = loadSessionCosts(path.join(testDir, 'nonexistent'));
    expect(loaded).toEqual([]);
  });

  it('skips malformed lines without crashing', () => {
    fs.mkdirSync(testDir, { recursive: true });
    const filePath = path.join(testDir, 'session-costs.jsonl');
    fs.writeFileSync(filePath, '{"repoName":"good","totalEstimatedCostUsd":1}\nBAD LINE\n{"repoName":"also-good","totalEstimatedCostUsd":2}\n');
    const loaded = loadSessionCosts(testDir);
    expect(loaded).toHaveLength(2);
  });

  it('buildSessionCostEntry creates entry from RunMetrics', () => {
    const metrics: RunMetrics = {
      startedAt: '2026-04-06T00:00:00.000Z',
      completedAt: '2026-04-06T00:05:00.000Z',
      durationMs: 300_000,
      toolCalls: 40,
      models: {
        'sonnet': { bedrockModelId: 'sonnet', calls: 30, inputTokens: 60000, outputTokens: 12000, cachedTokens: 3000, estimatedCostUsd: 0.55 },
        'haiku': { bedrockModelId: 'haiku', calls: 10, inputTokens: 15000, outputTokens: 5000, cachedTokens: 0, estimatedCostUsd: 0.19 },
      },
      totalEstimatedCostUsd: 0.74,
    };
    const entry = buildSessionCostEntry('my-repo', 'audit', metrics);
    expect(entry.repoName).toBe('my-repo');
    expect(entry.goalType).toBe('audit');
    expect(entry.totalEstimatedCostUsd).toBe(0.74);
    expect(entry.toolCalls).toBe(40);
  });

  it('aggregateSessionCosts computes totals', () => {
    const entries = [
      makeEntry({ repoName: 'repo-a', goalType: 'onboarding', totalEstimatedCostUsd: 0.50, durationMs: 200_000, toolCalls: 30 }),
      makeEntry({ repoName: 'repo-a', goalType: 'audit', totalEstimatedCostUsd: 0.80, durationMs: 300_000, toolCalls: 45 }),
      makeEntry({ repoName: 'repo-b', goalType: 'onboarding', totalEstimatedCostUsd: 1.20, durationMs: 400_000, toolCalls: 50 }),
    ];
    const agg = aggregateSessionCosts(entries);
    expect(agg.totalRuns).toBe(3);
    expect(agg.totalCostUsd).toBe(2.5);
    expect(agg.totalToolCalls).toBe(125);
    expect(agg.costByRepo['repo-a']).toBeCloseTo(1.3);
    expect(agg.costByRepo['repo-b']).toBeCloseTo(1.2);
    expect(agg.costByGoal['onboarding']).toBeCloseTo(1.7);
    expect(agg.costByGoal['audit']).toBeCloseTo(0.8);
  });
});
