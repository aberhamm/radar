import { describe, it, expect } from 'vitest';
import { recordFinding } from '../../../src/tools/analysis/recordFinding.js';
import type { AgentState } from '../../../src/types/state.js';
import type { Finding } from '../../../src/types/findings.js';
import path from 'node:path';

const FIXTURE_ROOT = path.resolve('test/fixtures/sitecore-minimal');

function makeState(): AgentState {
  return {
    goal: 'onboarding',
    repo: { source: 'local', localPath: FIXTURE_ROOT, name: 'test' },
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
    fileReadCache: new Map(),
  };
}

describe('recordFinding', () => {
  it('adds finding to state and returns count', async () => {
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
    const result = await recordFinding(state, { finding });
    expect(result.findingId).toBe('TEST-001');
    expect(result.totalFindings).toBe(1);
    expect(state.findings).toHaveLength(1);
  });

  it('throws on missing required fields', async () => {
    const state = makeState();
    // No id, category, or severity at any level
    await expect(
      recordFinding(state, { finding: { title: 'bad', description: 'no keys' } as unknown as Finding }),
    ).rejects.toThrow();
  });

  it('handles array of findings in a single call', async () => {
    const state = makeState();
    // LLM sometimes passes an array instead of a single finding
    const batchInput = {
      finding: [
        { id: 'BATCH-001', category: 'security', severity: 'high', title: 'First', description: 'Desc', evidence: [], tags: [] },
        { id: 'BATCH-002', category: 'stack', severity: 'info', title: 'Second', description: 'Desc', evidence: [], tags: [] },
      ],
    };
    const result = await recordFinding(state, batchInput as unknown as { finding: Finding });
    expect(result.findingId).toBe('BATCH-001, BATCH-002');
    expect(result.totalFindings).toBe(2);
    expect(result.recordedCount).toBe(2);
    expect(state.findings).toHaveLength(2);
  });

  it('handles numeric-keyed object (array serialized as object)', async () => {
    const state = makeState();
    // When JSON.parse turns an array into an object with numeric keys
    const numericInput = {
      '0': { id: 'NUM-001', category: 'architecture', severity: 'medium', title: 'Arch', description: 'D', evidence: [], tags: [] },
      '1': { id: 'NUM-002', category: 'dependencies', severity: 'low', title: 'Dep', description: 'D', evidence: [], tags: [] },
    };
    const result = await recordFinding(state, numericInput as unknown as { finding: Finding });
    expect(result.totalFindings).toBe(2);
    expect(state.findings).toHaveLength(2);
  });

  it('rejects finding with numeric severity', async () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-001', category: 'security', severity: 42, title: 'Numeric sev', description: 'D', evidence: [], tags: [] },
    };
    await expect(recordFinding(state, bad as unknown as { finding: Finding })).rejects.toThrow();
  });

  it('rejects finding with null category', async () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-002', category: null, severity: 'high', title: 'Null cat', description: 'D', evidence: [], tags: [] },
    };
    await expect(recordFinding(state, bad as unknown as { finding: Finding })).rejects.toThrow();
  });

  it('rejects finding with invalid severity string', async () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-003', category: 'security', severity: 'urgent', title: 'Bad sev', description: 'D', evidence: [], tags: [] },
    };
    await expect(recordFinding(state, bad as unknown as { finding: Finding })).rejects.toThrow();
  });

  it('rejects finding with invalid category string', async () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-004', category: 'unknown-cat', severity: 'high', title: 'Bad cat', description: 'D', evidence: [], tags: [] },
    };
    await expect(recordFinding(state, bad as unknown as { finding: Finding })).rejects.toThrow();
  });

  it('rejects finding with missing title', async () => {
    const state = makeState();
    const bad = {
      finding: { id: 'BAD-005', category: 'security', severity: 'high', description: 'No title', evidence: [], tags: [] },
    };
    await expect(recordFinding(state, bad as unknown as { finding: Finding })).rejects.toThrow();
  });

  // --- Evidence verification tests ---

  it('rejects evidence for files not in filesRead', async () => {
    const state = makeState();
    // Don't add to filesRead — agent never read this file
    const finding: Finding = {
      id: 'UNREAD-001',
      category: 'security',
      severity: 'high',
      title: 'Unread file',
      description: 'Cites a file the agent never read',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 4,
        snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
        description: 'Some evidence',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding });
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('never read'))).toBe(true);
    expect(result.rejectedEvidenceCount).toBe(1);
    expect(state.findings[0].evidence).toHaveLength(0);
  });

  it('verifies evidence when snippet matches actual file', async () => {
    const state = makeState();
    state.filesRead.add('src/middleware.ts');
    const finding: Finding = {
      id: 'VERIFIED-001',
      category: 'security',
      severity: 'info',
      title: 'Correct snippet',
      description: 'Snippet matches the real file',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 5,
        snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
        description: 'Reads from env',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding });
    expect(result.rejectedEvidenceCount).toBeUndefined();
    expect(state.findings[0].evidence).toHaveLength(1);
    expect(state.findings[0].evidence[0].verificationStatus).toBe('verified');
  });

  it('auto-corrects evidence when snippet does not match', async () => {
    const state = makeState();
    state.filesRead.add('src/middleware.ts');
    const finding: Finding = {
      id: 'CORRECTED-001',
      category: 'security',
      severity: 'critical',
      title: 'Hallucinated snippet',
      description: 'Agent fabricated the code',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 4,
        snippet: "const API_KEY = '[REDACTED]';",
        description: 'Hardcoded key',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding });
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('auto-corrected'))).toBe(true);
    const ev = state.findings[0].evidence[0];
    expect(ev.verificationStatus).toBe('corrected');
    expect(ev.originalSnippet).toBe("const API_KEY = '[REDACTED]';");
    expect(ev.snippet).toContain('process.env.SITECORE_API_KEY');
  });

  it('rejects evidence for non-existent file (even if in filesRead)', async () => {
    const state = makeState();
    state.filesRead.add('src/ghost.ts');
    const finding: Finding = {
      id: 'GHOST-001',
      category: 'security',
      severity: 'high',
      title: 'Ghost file',
      description: 'File does not exist',
      evidence: [{
        filePath: 'src/ghost.ts',
        lineNumber: 1,
        snippet: 'fake code',
        description: 'Nonexistent',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding });
    expect(result.rejectedEvidenceCount).toBe(1);
    expect(state.findings[0].evidence).toHaveLength(0);
  });

  it('drops evidence items without snippet', async () => {
    const state = makeState();
    state.filesRead.add('src/middleware.ts');
    const finding = {
      id: 'NOSNIP-001',
      category: 'security',
      severity: 'medium',
      title: 'No snippet',
      description: 'Evidence has no snippet',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 4,
        // no snippet field
        description: 'Missing snippet',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding } as unknown as { finding: Finding });
    // Evidence without snippet is dropped during toEvidence parsing
    expect(state.findings[0].evidence).toHaveLength(0);
  });

  it('returns warnings array in output', async () => {
    const state = makeState();
    // File not in filesRead → should produce warning
    const finding: Finding = {
      id: 'WARN-001',
      category: 'stack',
      severity: 'info',
      title: 'Warning test',
      description: 'Should produce warnings',
      evidence: [{
        filePath: 'package.json',
        lineNumber: 1,
        snippet: '"name": "test"',
        description: 'Package name',
      }],
      tags: [],
    };
    const result = await recordFinding(state, { finding });
    expect(result.warnings).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings!.length).toBeGreaterThan(0);
  });
});
