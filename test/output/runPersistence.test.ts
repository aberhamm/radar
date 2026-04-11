import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { persistRunToTieredStorage } from '../../src/output/runPersistence.js';
import type { RunEnvelopeData } from '../../src/output/runPersistence.js';
import type { Scorecard, RunMetrics } from '../../src/types/output.js';
import type { Finding } from '../../src/types/findings.js';

// ── Minimal mocks ───────────────────────────────────────────

function makeScorecard(overrides?: Partial<Scorecard>): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'audit',
    generatedAt: '2026-04-11T00:00:00Z',
    overallScore: 'green',
    categories: [],
    topRisks: [],
    ...overrides,
  };
}

function makeMetrics(overrides?: Partial<RunMetrics>): RunMetrics {
  return {
    startedAt: '2026-04-11T00:00:00Z',
    completedAt: '2026-04-11T00:01:00Z',
    durationMs: 1000,
    toolCalls: 10,
    models: {},
    totalEstimatedCostUsd: 0.5,
    ...overrides,
  };
}

function makeFinding(overrides?: Partial<Finding>): Finding {
  return {
    id: 'F-1',
    category: 'stack',
    severity: 'medium',
    confidence: 8,
    title: 'Test',
    description: 'desc',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

function makeData(overrides?: Partial<RunEnvelopeData>): RunEnvelopeData {
  return {
    id: 'run-001',
    goal: 'audit',
    repoName: 'test-repo',
    startedAt: '2026-04-11T00:00:00Z',
    completedAt: '2026-04-11T00:01:00Z',
    scorecard: makeScorecard(),
    metrics: makeMetrics(),
    briefMarkdown: '# Brief\nSome content',
    terminationReason: 'budget_exhausted',
    findings: [makeFinding()],
    ...overrides,
  };
}

// ── Spies ───────────────────────────────────────────────────

let writtenFiles: Map<string, string>;
let existsSyncSpy: ReturnType<typeof vi.spyOn>;
let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;
let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
let renameSyncSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writtenFiles = new Map();

  existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const key = String(p);
    // The run dir and runsDir always "exist" after mkdir
    // index.json may or may not exist depending on test
    return writtenFiles.has(key);
  });

  mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

  writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data) => {
    writtenFiles.set(String(p), String(data));
  });

  readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
    const content = writtenFiles.get(String(p));
    if (content !== undefined) return content;
    throw new Error(`ENOENT: ${String(p)}`);
  });

  renameSyncSpy = vi.spyOn(fs, 'renameSync').mockImplementation((src, dest) => {
    const content = writtenFiles.get(String(src));
    if (content !== undefined) {
      writtenFiles.set(String(dest), content);
      writtenFiles.delete(String(src));
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────

describe('persistRunToTieredStorage', () => {
  const runsDir = '/tmp/runs';

  it('writes all tiered files', () => {
    const data = makeData();
    const events = [{ step: 1, action: 'read_file', result: 'ok' }];

    persistRunToTieredStorage(runsDir, data, events);

    const runDir = path.join(runsDir, data.id);
    const envelopePath = path.join(runDir, 'envelope.json');
    const eventsPath = path.join(runDir, 'events.jsonl');
    const findingsPath = path.join(runDir, 'findings.json');
    const indexPath = path.join(runsDir, 'index.json');

    // envelope.json written
    expect(writtenFiles.has(envelopePath)).toBe(true);
    const envelope = JSON.parse(writtenFiles.get(envelopePath)!);
    expect(envelope.id).toBe('run-001');
    expect(envelope.goal).toBe('audit');
    expect(envelope.scorecard).toBeDefined();
    expect(envelope.findingsSummary).toHaveLength(1);

    // events.jsonl written
    expect(writtenFiles.has(eventsPath)).toBe(true);
    const eventLines = writtenFiles.get(eventsPath)!.trim().split('\n');
    expect(eventLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0]).action).toBe('read_file');

    // findings.json written
    expect(writtenFiles.has(findingsPath)).toBe(true);
    const findings = JSON.parse(writtenFiles.get(findingsPath)!);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('F-1');

    // index.json written (via .tmp rename)
    expect(writtenFiles.has(indexPath)).toBe(true);
    const index = JSON.parse(writtenFiles.get(indexPath)!);
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('run-001');
    expect(index[0].status).toBe('completed');
  });

  it('includes parentRunId in envelope and index when set', () => {
    const data = makeData({ parentRunId: 'parent-run-abc' });

    persistRunToTieredStorage(runsDir, data);

    const runDir = path.join(runsDir, data.id);
    const envelopePath = path.join(runDir, 'envelope.json');
    const indexPath = path.join(runsDir, 'index.json');

    // Envelope has parentRunId
    const envelope = JSON.parse(writtenFiles.get(envelopePath)!);
    expect(envelope.parentRunId).toBe('parent-run-abc');

    // Index entry has parentRunId
    const index = JSON.parse(writtenFiles.get(indexPath)!);
    expect(index[0].parentRunId).toBe('parent-run-abc');
  });

  it('omits parentRunId when not set', () => {
    const data = makeData(); // no parentRunId

    persistRunToTieredStorage(runsDir, data);

    const runDir = path.join(runsDir, data.id);
    const envelopePath = path.join(runDir, 'envelope.json');
    const indexPath = path.join(runsDir, 'index.json');

    const envelope = JSON.parse(writtenFiles.get(envelopePath)!);
    expect(envelope).not.toHaveProperty('parentRunId');

    const index = JSON.parse(writtenFiles.get(indexPath)!);
    expect(index[0]).not.toHaveProperty('parentRunId');
  });

  it('updates existing index entry idempotently', () => {
    const indexPath = path.join(runsDir, 'index.json');

    // Pre-populate index.json with an existing entry for the same run id
    const existingIndex = [
      {
        id: 'run-001',
        goal: 'audit',
        repoName: 'test-repo',
        overallScore: 'yellow',
        startedAt: '2026-04-11T00:00:00Z',
        findingsCount: 0,
        status: 'in_progress',
      },
    ];
    writtenFiles.set(indexPath, JSON.stringify(existingIndex));

    const data = makeData();
    persistRunToTieredStorage(runsDir, data);

    const index = JSON.parse(writtenFiles.get(indexPath)!);

    // Should have exactly one entry (updated, not duplicated)
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('run-001');
    expect(index[0].overallScore).toBe('green');
    expect(index[0].findingsCount).toBe(1);
    expect(index[0].status).toBe('completed');
  });

  it('handles fs errors gracefully', () => {
    // Restore the default mock then override writeFileSync to throw
    writeFileSyncSpy.mockRestore();
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw
    expect(() => {
      persistRunToTieredStorage(runsDir, makeData());
    }).not.toThrow();

    // Should log the error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[persistRunToTieredStorage]'),
      expect.stringContaining('EACCES'),
    );

    consoleSpy.mockRestore();
  });
});
