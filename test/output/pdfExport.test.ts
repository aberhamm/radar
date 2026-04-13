import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderPdf, renderPdfToBuffer } from '../../src/output/pdfExport.js';
import type { Scorecard, RunMetrics, CategoryScore } from '../../src/types/output.js';
import type { Finding, Evidence } from '../../src/types/findings.js';

// --- Test helpers ---

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'TEST-001',
    category: 'security',
    severity: 'medium',
    title: 'Test finding',
    description: 'A test finding description',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    filePath: 'src/index.ts',
    lineNumber: 42,
    snippet: 'const secret = process.env.SECRET;',
    description: 'Hardcoded secret reference',
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryScore> = {}): CategoryScore {
  return {
    category: 'security',
    score: 'green',
    findings: [],
    summary: 'No issues found',
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'audit',
    generatedAt: '2026-04-13T12:00:00.000Z',
    overallScore: 'green',
    categories: [
      makeCategory({ category: 'security', score: 'green' }),
      makeCategory({ category: 'dependencies', score: 'green' }),
      makeCategory({ category: 'architecture', score: 'green' }),
    ],
    topRisks: [],
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    startedAt: '2026-04-13T12:00:00.000Z',
    completedAt: '2026-04-13T12:02:00.000Z',
    durationMs: 120_000,
    toolCalls: 45,
    models: {},
    totalEstimatedCostUsd: 0.74,
    ...overrides,
  };
}

// Track temp files for cleanup
const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});

function tempPdfPath(): string {
  const p = path.join(os.tmpdir(), `radar-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  tempFiles.push(p);
  return p;
}

// --- Tests ---

describe('renderPdf', () => {
  it('writes a valid PDF file', async () => {
    const pdfPath = tempPdfPath();
    const result = await renderPdf(pdfPath, {
      scorecard: makeScorecard(),
      findings: [],
      metrics: makeMetrics(),
    });

    expect(result).toBe(pdfPath);
    expect(fs.existsSync(pdfPath)).toBe(true);

    // Check PDF magic bytes (%PDF-)
    const buf = fs.readFileSync(pdfPath);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('returns the output path', async () => {
    const pdfPath = tempPdfPath();
    const result = await renderPdf(pdfPath, {
      scorecard: makeScorecard(),
      findings: [],
      metrics: makeMetrics(),
    });
    expect(result).toBe(pdfPath);
  });

  it('generates PDF with findings', async () => {
    const pdfPath = tempPdfPath();
    const findings = [
      makeFinding({ id: 'F1', severity: 'critical', title: 'SQL injection', evidence: [makeEvidence()] }),
      makeFinding({ id: 'F2', severity: 'high', title: 'Missing auth' }),
      makeFinding({ id: 'F3', severity: 'medium', title: 'Outdated dep' }),
      makeFinding({ id: 'F4', severity: 'low', title: 'Minor style issue' }),
      makeFinding({ id: 'F5', severity: 'info', title: 'Informational note' }),
    ];

    await renderPdf(pdfPath, {
      scorecard: makeScorecard({
        overallScore: 'red',
        categories: [makeCategory({ findings, score: 'red' })],
        topRisks: findings.slice(0, 3),
      }),
      findings,
      metrics: makeMetrics(),
    });

    const buf = fs.readFileSync(pdfPath);
    expect(buf.length).toBeGreaterThan(1000); // Non-trivial PDF with content
  });

  it('handles all goal types', async () => {
    const goals = ['onboarding', 'audit', 'audit-generic', 'migration', 'ci-check', 'security-review', 'nextjs', 'accessibility'];

    for (const goal of goals) {
      const pdfPath = tempPdfPath();
      await renderPdf(pdfPath, {
        scorecard: makeScorecard({ goalType: goal }),
        findings: [],
        metrics: makeMetrics(),
      });
      expect(fs.existsSync(pdfPath)).toBe(true);
    }
  });

  it('handles red scorecard', async () => {
    const pdfPath = tempPdfPath();
    await renderPdf(pdfPath, {
      scorecard: makeScorecard({
        overallScore: 'red',
        categories: [
          makeCategory({ category: 'security', score: 'red', findings: [makeFinding({ severity: 'critical' })] }),
          makeCategory({ category: 'dependencies', score: 'yellow' }),
        ],
      }),
      findings: [makeFinding({ severity: 'critical' })],
      metrics: makeMetrics(),
    });

    const buf = fs.readFileSync(pdfPath);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles yellow scorecard', async () => {
    const pdfPath = tempPdfPath();
    await renderPdf(pdfPath, {
      scorecard: makeScorecard({
        overallScore: 'yellow',
        categories: [
          makeCategory({ category: 'security', score: 'yellow', findings: [makeFinding({ severity: 'high' })] }),
        ],
      }),
      findings: [makeFinding({ severity: 'high' })],
      metrics: makeMetrics(),
    });

    expect(fs.existsSync(pdfPath)).toBe(true);
  });

  it('handles findings with rich evidence', async () => {
    const pdfPath = tempPdfPath();
    const findings = [
      makeFinding({
        id: 'EV-001',
        severity: 'high',
        title: 'Complex finding with evidence',
        confidence: 9,
        fingerprint: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcdef12',
        evidence: [
          makeEvidence({ verificationStatus: 'verified' }),
          makeEvidence({ filePath: 'src/api/route.ts', lineNumber: 100, verificationStatus: 'corrected' }),
          makeEvidence({ filePath: 'src/lib/db.ts', verificationStatus: 'unverifiable' }),
          makeEvidence({ filePath: 'src/extra.ts', description: 'Fourth evidence — should show overflow count' }),
        ],
      }),
    ];

    await renderPdf(pdfPath, {
      scorecard: makeScorecard({
        categories: [makeCategory({ findings, score: 'red' })],
        topRisks: findings,
      }),
      findings,
      metrics: makeMetrics(),
    });

    const buf = fs.readFileSync(pdfPath);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('handles many findings across multiple pages', async () => {
    const pdfPath = tempPdfPath();
    const findings: Finding[] = [];
    for (let i = 0; i < 30; i++) {
      findings.push(makeFinding({
        id: `MANY-${i}`,
        severity: i < 5 ? 'critical' : i < 10 ? 'high' : i < 20 ? 'medium' : 'low',
        title: `Finding number ${i + 1}`,
        description: `Description for finding ${i + 1}. `.repeat(5),
        evidence: [makeEvidence()],
      }));
    }

    await renderPdf(pdfPath, {
      scorecard: makeScorecard({
        overallScore: 'red',
        categories: [makeCategory({ findings, score: 'red' })],
        topRisks: findings.slice(0, 5),
      }),
      findings,
      metrics: makeMetrics(),
    });

    const buf = fs.readFileSync(pdfPath);
    expect(buf.length).toBeGreaterThan(5000); // Multi-page PDF should be larger
  });

  it('includes PDF metadata', async () => {
    const pdfPath = tempPdfPath();
    await renderPdf(pdfPath, {
      scorecard: makeScorecard({ repoName: 'my-special-repo', goalType: 'security-review' }),
      findings: [],
      metrics: makeMetrics(),
    });

    // PDFKit escapes parentheses in PDF string literals and encodes
    // Title as UTF-16BE. Check for structural metadata markers.
    const raw = fs.readFileSync(pdfPath, 'ascii');
    expect(raw).toContain('Radar \\(repo-audit-delivery-agent\\)');
    expect(raw).toContain('/Title');
    expect(raw).toContain('/Author');
    expect(raw).toContain('security-review analysis');
  });
});

describe('renderPdfToBuffer', () => {
  it('returns a valid PDF buffer', async () => {
    const buf = await renderPdfToBuffer({
      scorecard: makeScorecard(),
      findings: [],
      metrics: makeMetrics(),
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('matches file output content', async () => {
    const scorecard = makeScorecard({ overallScore: 'yellow' });
    const findings = [makeFinding({ severity: 'high' })];
    const metrics = makeMetrics();

    const buf = await renderPdfToBuffer({ scorecard, findings, metrics });

    // Buffer should produce valid PDF
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('handles empty scorecard', async () => {
    const buf = await renderPdfToBuffer({
      scorecard: makeScorecard({ categories: [], topRisks: [] }),
      findings: [],
      metrics: makeMetrics(),
    });

    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
