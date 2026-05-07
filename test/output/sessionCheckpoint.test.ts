import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  serializeState,
  hydrateState,
  saveCheckpoint,
  loadLatestCheckpoint,
  buildCheckpointEntry,
  buildSessionId,
  buildResumeSummary,
  checkpointPath,
} from '../../src/output/sessionCheckpoint.js';
import type { AgentState } from '../../src/types/state.js';

function makeState(overrides?: Partial<AgentState>): AgentState {
  return {
    goal: 'audit',
    repo: { source: 'local', localPath: '/tmp/test-repo', name: 'test-repo' },
    resolvedVersions: {},
    findings: [
      {
        id: 'F-001',
        category: 'security',
        severity: 'high',
        confidence: 8,
        title: 'Exposed API key',
        description: 'Key found in config',
        evidence: [{ filePath: 'src/config.ts', lineNumber: 5, snippet: 'key = "sk-"', description: 'Hardcoded key' }],
        tags: ['security'],
      },
    ],
    filesRead: new Set(['package.json', 'src/config.ts', 'tsconfig.json']),
    fileReadCache: new Map([
      ['package.json', { mtime: 1000, contentHash: 'abc123' }],
    ]),
    toolCallCount: 12,
    totalToolCallsExecuted: 12,
    toolCallBudget: 45,
    webSearchCount: 1,
    webSearchBudget: 5,
    urlFetchCount: 0,
    urlFetchBudget: 3,
    docTokensUsed: 500,
    docTokenBudget: 20000,
    fetchedDocs: [],
    investigationLog: [
      { step: 1, action: 'read_file', reasoning: 'Check package.json', result: 'Found Next.js 14' },
    ],
    modelUsage: new Map([
      ['sonnet-4.6', { calls: 10, inputTokens: 5000, outputTokens: 2000, cachedTokens: 1000 }],
    ]),
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('serializeState / hydrateState', () => {
  it('round-trips Set fields correctly', () => {
    const state = makeState();
    const serialized = serializeState(state);

    // Set → array
    expect(Array.isArray(serialized.filesRead)).toBe(true);
    expect(serialized.filesRead).toContain('package.json');

    const hydrated = hydrateState(serialized);
    expect(hydrated.filesRead).toBeInstanceOf(Set);
    expect(hydrated.filesRead.has('package.json')).toBe(true);
    expect(hydrated.filesRead.size).toBe(3);
  });

  it('round-trips Map fields correctly', () => {
    const state = makeState();
    const serialized = serializeState(state);

    // Map → Record
    expect(typeof serialized.fileReadCache).toBe('object');
    expect(serialized.fileReadCache['package.json']).toEqual({ mtime: 1000, contentHash: 'abc123' });

    const hydrated = hydrateState(serialized);
    expect(hydrated.fileReadCache).toBeInstanceOf(Map);
    expect(hydrated.fileReadCache.get('package.json')).toEqual({ mtime: 1000, contentHash: 'abc123' });
  });

  it('round-trips modelUsage correctly', () => {
    const state = makeState();
    const serialized = serializeState(state);
    const hydrated = hydrateState(serialized);

    expect(hydrated.modelUsage).toBeInstanceOf(Map);
    expect(hydrated.modelUsage.get('sonnet-4.6')).toEqual({
      calls: 10, inputTokens: 5000, outputTokens: 2000, cachedTokens: 1000,
    });
  });

  it('preserves scalar fields', () => {
    const state = makeState();
    const hydrated = hydrateState(serializeState(state));

    expect(hydrated.goal).toBe('audit');
    expect(hydrated.toolCallCount).toBe(12);
    expect(hydrated.toolCallBudget).toBe(45);
    expect(hydrated.findings).toHaveLength(1);
    expect(hydrated.findings[0].confidence).toBe(8);
  });

  it('handles empty Set/Map', () => {
    const state = makeState({
      filesRead: new Set(),
      fileReadCache: new Map(),
      modelUsage: new Map(),
    });
    const hydrated = hydrateState(serializeState(state));
    expect(hydrated.filesRead.size).toBe(0);
    expect(hydrated.fileReadCache.size).toBe(0);
    expect(hydrated.modelUsage.size).toBe(0);
  });
});

describe('saveCheckpoint / loadLatestCheckpoint', () => {
  it('saves and loads a single checkpoint', () => {
    const state = makeState();
    const entry = buildCheckpointEntry('test-session', 1, 'periodic', state);
    saveCheckpoint(tmpDir, 'test-repo', entry);

    const filePath = checkpointPath(tmpDir, 'test-repo');
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadLatestCheckpoint(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.seq).toBe(1);
    expect(loaded!.sessionId).toBe('test-session');
    expect(loaded!.trigger).toBe('periodic');
    expect(loaded!.state.findings).toHaveLength(1);
  });

  it('returns the latest checkpoint by seq', () => {
    const state = makeState();
    saveCheckpoint(tmpDir, 'test-repo',
      buildCheckpointEntry('test-session', 1, 'periodic', state));

    state.toolCallCount = 20;
    state.findings.push({
      id: 'F-002', category: 'dependencies', severity: 'medium',
      title: 'Outdated deps', description: 'Behind latest',
      evidence: [], tags: [],
    });
    saveCheckpoint(tmpDir, 'test-repo',
      buildCheckpointEntry('test-session', 2, 'periodic', state));

    const loaded = loadLatestCheckpoint(checkpointPath(tmpDir, 'test-repo'));
    expect(loaded!.seq).toBe(2);
    expect(loaded!.state.toolCallCount).toBe(20);
    expect(loaded!.state.findings).toHaveLength(2);
  });

  it('returns null for non-existent file', () => {
    expect(loadLatestCheckpoint('/nonexistent/path.jsonl')).toBeNull();
  });

  it('skips malformed lines gracefully', () => {
    const filePath = checkpointPath(tmpDir, 'test-repo');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(filePath, 'not json\n{"seq":1,"sessionId":"s","savedAt":"2026-01-01","trigger":"periodic","state":{"goal":"audit","repo":{"source":"local","localPath":"/tmp","name":"t"},"resolvedVersions":{},"findings":[],"filesRead":[],"fileReadCache":{},"toolCallCount":5,"toolCallBudget":45,"webSearchCount":0,"webSearchBudget":5,"urlFetchCount":0,"urlFetchBudget":3,"docTokensUsed":0,"docTokenBudget":20000,"fetchedDocs":[],"investigationLog":[],"modelUsage":{}}}\n');

    const loaded = loadLatestCheckpoint(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.seq).toBe(1);
  });
});

describe('buildSessionId', () => {
  it('includes repo name and goal', () => {
    const id = buildSessionId('my-repo', 'audit');
    expect(id).toContain('my-repo');
    expect(id).toContain('audit');
  });
});

describe('buildResumeSummary', () => {
  it('includes findings count and categories', () => {
    const state = makeState();
    const summary = buildResumeSummary(state);

    expect(summary).toContain('Findings recorded: 1');
    expect(summary).toContain('security: 1');
    expect(summary).toContain('Tool calls used: 12 / 45');
  });

  it('includes files read list', () => {
    const state = makeState();
    const summary = buildResumeSummary(state);
    expect(summary).toContain('package.json');
    expect(summary).toContain('src/config.ts');
  });

  it('includes key findings with confidence', () => {
    const state = makeState();
    const summary = buildResumeSummary(state);
    expect(summary).toContain('[high] Exposed API key');
    expect(summary).toContain('confidence 8/10');
  });

  it('handles empty state', () => {
    const state = makeState({ findings: [], filesRead: new Set() });
    const summary = buildResumeSummary(state);
    expect(summary).toContain('Findings recorded: 0');
    expect(summary).not.toContain('Key findings');
    expect(summary).not.toContain('Files already read');
  });

  it('includes stack profile when detected', () => {
    const state = makeState({
      stackProfile: {
        projectType: 'sitecore',
        projectTypeConfidence: 'high',
        framework: { name: 'Next.js', version: '14.1.0', routerType: 'pages' },
        cms: { platform: 'Sitecore XM Cloud', sdkPackages: [], integrationStyle: 'JSS' },
        packageManager: 'npm',
        language: 'typescript',
        deploymentIndicators: [],
        monorepo: false,
      },
    });
    const summary = buildResumeSummary(state);
    expect(summary).toContain('Next.js 14.1.0');
    expect(summary).toContain('Sitecore XM Cloud');
  });
});
