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

const VALID_FINDING = {
  id: 'EX-001',
  category: 'security',
  severity: 'high',
  title: 'Test finding',
  description: 'A test',
  evidence: [],
  tags: [],
};

// ─── Extraction: double-nested finding ───

describe('recordFinding extraction paths', () => {
  it('handles double-nested { finding: { finding: {...} } }', async () => {
    const state = makeState();
    const input = {
      finding: {
        finding: { ...VALID_FINDING, id: 'DOUBLE-001' },
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    expect(result.findingId).toBe('DOUBLE-001');
    expect(state.findings).toHaveLength(1);
  });

  it('handles flat finding (no wrapper)', async () => {
    const state = makeState();
    const input = {
      id: 'FLAT-001',
      category: 'architecture',
      severity: 'medium',
      title: 'Flat finding',
      description: 'No wrapper object',
      evidence: [],
      tags: [],
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    expect(result.findingId).toBe('FLAT-001');
    expect(state.findings).toHaveLength(1);
  });

  it('handles numeric-keyed object under finding field', async () => {
    const state = makeState();
    const input = {
      finding: {
        '0': { id: 'FNUM-001', category: 'security', severity: 'high', title: 'First', description: 'D', evidence: [], tags: [] },
        '1': { id: 'FNUM-002', category: 'stack', severity: 'info', title: 'Second', description: 'D', evidence: [], tags: [] },
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    expect(result.totalFindings).toBe(2);
    expect(state.findings).toHaveLength(2);
  });
});

// ─── documentationRefs ───

describe('recordFinding documentationRefs', () => {
  it('preserves valid documentationRefs', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'DOC-001',
        documentationRefs: [
          { url: 'https://example.com/docs', title: 'Setup Guide', relevance: 'Explains config pattern' },
        ],
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].documentationRefs).toHaveLength(1);
    expect(state.findings[0].documentationRefs![0].url).toBe('https://example.com/docs');
  });

  it('filters out invalid documentationRefs', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'DOC-002',
        documentationRefs: [
          { url: 'https://example.com', title: 'Good', relevance: 'Valid' },
          { url: 123, title: 'Bad URL type', relevance: 'Invalid' }, // invalid
          null, // null entry
        ],
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].documentationRefs).toHaveLength(1);
  });

  it('omits documentationRefs when all are invalid', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'DOC-003',
        documentationRefs: [
          { url: 123, title: null }, // all invalid
        ],
      },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].documentationRefs).toBeUndefined();
  });
});

// ─── Tags filtering ───

describe('recordFinding tags filtering', () => {
  it('filters out non-string tags', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'TAG-001',
        tags: ['valid', 42, null, 'also-valid', undefined],
      },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].tags).toEqual(['valid', 'also-valid']);
  });

  it('returns empty tags array when tags is not an array', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'TAG-002',
        tags: 'not-an-array',
      },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].tags).toEqual([]);
  });
});

// ─── investigationNote ───

describe('recordFinding investigationNote', () => {
  it('preserves investigationNote when present', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'NOTE-001',
        investigationNote: 'Checked 3 files, pattern is consistent',
      },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].investigationNote).toBe('Checked 3 files, pattern is consistent');
  });

  it('omits investigationNote when not a string', async () => {
    const state = makeState();
    const input = {
      finding: {
        ...VALID_FINDING,
        id: 'NOTE-002',
        investigationNote: 42,
      },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].investigationNote).toBeUndefined();
  });
});

// ─── Confidence boundaries ───

describe('recordFinding confidence boundaries', () => {
  it('rejects confidence below 1', async () => {
    const state = makeState();
    const input = {
      finding: { ...VALID_FINDING, id: 'CONF-LO', confidence: 0 },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].confidence).toBeUndefined();
  });

  it('rejects confidence above 10', async () => {
    const state = makeState();
    const input = {
      finding: { ...VALID_FINDING, id: 'CONF-HI', confidence: 11 },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].confidence).toBeUndefined();
  });

  it('accepts confidence at boundary 1', async () => {
    const state = makeState();
    const input = {
      finding: { ...VALID_FINDING, id: 'CONF-MIN', confidence: 1 },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].confidence).toBe(1);
  });

  it('accepts confidence at boundary 10', async () => {
    const state = makeState();
    const input = {
      finding: { ...VALID_FINDING, id: 'CONF-MAX', confidence: 10 },
    };
    await recordFinding(state, input as unknown as { finding: Finding });
    expect(state.findings[0].confidence).toBe(10);
  });
});

// ─── Description-evidence coherence ───

describe('recordFinding description-evidence coherence', () => {
  it('warns when description claims a package not in evidence', async () => {
    const state = makeState();
    state.filesRead.add('src/middleware.ts');
    const input = {
      finding: {
        id: 'COH-001',
        category: 'dependencies',
        severity: 'medium',
        title: 'Outdated package',
        description: 'The project uses @sitecore-jss/sitecore-jss-nextjs version 21.1.0 which is outdated.',
        evidence: [{
          filePath: 'src/middleware.ts',
          lineNumber: 5,
          snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
          description: 'Uses Sitecore config',
        }],
        tags: [],
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    // Evidence snippet doesn't contain the package name or version
    const coherenceWarning = result.warnings?.find(w => w.includes('claims not found in evidence'));
    expect(coherenceWarning).toBeDefined();
  });

  it('does not warn when description claims appear in evidence', async () => {
    const state = makeState();
    state.filesRead.add('src/middleware.ts');
    const input = {
      finding: {
        id: 'COH-002',
        category: 'security',
        severity: 'high',
        title: 'API key in env',
        description: 'The middleware reads SITECORE_API_KEY from environment.',
        evidence: [{
          filePath: 'src/middleware.ts',
          lineNumber: 5,
          snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
          description: 'Reads SITECORE_API_KEY',
        }],
        tags: [],
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    const coherenceWarning = result.warnings?.find(w => w.includes('claims not found in evidence'));
    expect(coherenceWarning).toBeUndefined();
  });

  it('skips coherence check when finding has no evidence', async () => {
    const state = makeState();
    const input = {
      finding: {
        id: 'COH-003',
        category: 'dependencies',
        severity: 'medium',
        title: 'No evidence',
        description: 'Uses @sitecore-jss/sitecore-jss-nextjs but no evidence provided.',
        evidence: [],
        tags: [],
      },
    };
    const result = await recordFinding(state, input as unknown as { finding: Finding });
    const coherenceWarning = result.warnings?.find(w => w.includes('claims not found in evidence'));
    expect(coherenceWarning).toBeUndefined();
  });
});
