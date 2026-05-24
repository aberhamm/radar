import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// We import from the dashboard source using a relative path.
// agentSession uses node:fs and node:path which we'll mock for persist/load tests.

// The module under test
import {
  getSession,
  resetSession,
  persistRun,
  loadPersistedRuns,
  sendStreamEvent,
} from '../../dashboard/src/lib/agentSession.js';

import type { RunRecord, AgentSession } from '../../dashboard/src/lib/agentSession.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'test-run-1',
    goal: 'onboarding',
    repoName: 'test-repo',
    startedAt: new Date('2026-01-15T10:00:00Z'),
    completedAt: new Date('2026-01-15T10:05:00Z'),
    events: [{ step: 1, action: 'readFile', args: 'package.json' }],
    result: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe('agentSession — session management', () => {
  beforeEach(() => {
    // Clean up the global singleton between tests
    globalThis.__agentSession = undefined;
  });

  it('getSession() creates a singleton session on first call', () => {
    const session = getSession();
    expect(session).toBeDefined();
    expect(session.status).toBe('idle');
    expect(session.currentRun).toBeNull();
    expect(session.result).toBeNull();
    expect(Array.isArray(session.history)).toBe(true);
  });

  it('getSession() returns the same instance on subsequent calls', () => {
    const first = getSession();
    const second = getSession();
    expect(first).toBe(second);
  });

  it('resetSession() reloads history from disk', () => {
    const session = getSession();
    session.status = 'running';

    resetSession();

    const fresh = getSession();
    expect(fresh.status).toBe('idle');
    expect(fresh.currentRun).toBeNull();
    expect(fresh.result).toBeNull();
    // History reloaded from disk (clean state)
    expect(Array.isArray(fresh.history)).toBe(true);
  });

  it('resetSession() loads persisted runs when no prior session exists', () => {
    // No session has been created yet, so resetSession falls back to loadPersistedRuns()
    // This should not throw even if the output dir doesn't exist
    resetSession();
    const session = getSession();
    expect(session.status).toBe('idle');
    expect(Array.isArray(session.history)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSE stream helper
// ---------------------------------------------------------------------------

describe('agentSession — sendStreamEvent', () => {
  it('encodes and enqueues SSE-formatted data', () => {
    const chunks: Uint8Array[] = [];
    const mockController = {
      enqueue: (chunk: Uint8Array) => { chunks.push(chunk); },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const event = { type: 'step', step: 1, action: 'readFile' };
    sendStreamEvent(mockController, event);

    expect(chunks.length).toBe(1);
    const text = new TextDecoder().decode(chunks[0]);
    expect(text).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('silently handles null controller', () => {
    // Should not throw
    expect(() => sendStreamEvent(null, { type: 'test' })).not.toThrow();
  });

  it('silently handles closed stream (controller.enqueue throws)', () => {
    const mockController = {
      enqueue: () => { throw new TypeError('Controller is already closed'); },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    // Should not throw
    expect(() => sendStreamEvent(mockController, { type: 'test' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------

describe('agentSession — persistRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes tiered files to output/runs/{id}/ directory', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[]'); // empty index
    vi.spyOn(fs, 'renameSync').mockReturnValue(undefined);

    const record = makeRunRecord();
    persistRun(record);

    // Should write events.jsonl, findings.json, and index.json.tmp
    // (no envelope since record.result is undefined)
    const writtenPaths = writeFileSyncSpy.mock.calls.map(c => String(c[0]));
    expect(writtenPaths.some(p => p.includes('events.jsonl'))).toBe(true);
    expect(writtenPaths.some(p => p.includes('findings.json'))).toBe(true);
    expect(writtenPaths.some(p => p.includes('index.json.tmp'))).toBe(true);
  });

  it('creates the output directory if it does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[]');
    vi.spyOn(fs, 'renameSync').mockReturnValue(undefined);

    persistRun(makeRunRecord());

    const mkdirCalls = mkdirSyncSpy.mock.calls.map(c => String(c[0]));
    expect(mkdirCalls.some(p => p.includes('runs'))).toBe(true);
  });

  it('logs error and does not throw when writeFileSync fails', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => persistRun(makeRunRecord())).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    expect(String(consoleSpy.mock.calls[0][0])).toContain('[persist]');
  });
});

describe('agentSession — loadPersistedRuns', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads entries from index.json, newest first', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() } as unknown as fs.Stats);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([
      {
        id: 'run-b',
        goal: 'audit',
        repoName: 'repo-b',
        startedAt: '2026-01-02T00:00:00Z',
        completedAt: '2026-01-02T01:00:00Z',
        status: 'completed',
      },
      {
        id: 'run-a',
        goal: 'onboarding',
        repoName: 'repo-a',
        startedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
      },
    ]));

    const runs = loadPersistedRuns();

    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe('run-b');
    expect(runs[1].id).toBe('run-a');
    expect(runs[0].startedAt).toBeInstanceOf(Date);
    expect(runs[0].completedAt).toBeInstanceOf(Date);
    expect(runs[1].completedAt).toBeUndefined();
  });

  it('supports pagination with limit and offset', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() + 1 } as unknown as fs.Stats);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([
      { id: 'run-1', goal: 'audit', repoName: 'r1', startedAt: '2026-01-03T00:00:00Z' },
      { id: 'run-2', goal: 'audit', repoName: 'r2', startedAt: '2026-01-02T00:00:00Z' },
      { id: 'run-3', goal: 'audit', repoName: 'r3', startedAt: '2026-01-01T00:00:00Z' },
    ]));

    const page = loadPersistedRuns({ limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe('run-2');
    expect(page[1].id).toBe('run-3');
  });

  it('preserves parentRunId from index entries', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() + 2 } as unknown as fs.Stats);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([
      {
        id: 'child-1',
        goal: 'audit',
        repoName: 'repo',
        startedAt: '2026-01-01T00:00:00Z',
        parentRunId: 'parent-abc',
      },
    ]));

    const runs = loadPersistedRuns();
    expect(runs[0].parentRunId).toBe('parent-abc');
  });

  it('returns empty array when directory does not exist and creation fails', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('permission denied');
    });

    const runs = loadPersistedRuns();
    expect(runs).toEqual([]);
  });
});
