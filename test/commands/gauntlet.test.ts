import { describe, it, expect } from 'vitest';
import type { Finding } from '../../src/types/findings.js';

// ─── Inline copies of the pure gate functions from gauntlet.ts ───
// These are not exported, so we replicate the logic here for unit testing.
// If gauntlet.ts exports them in future, switch to direct imports.

interface EvidenceStats {
  total: number;
  unverifiable: number;
  unsupportedFindings: number;
}

function countEvidenceStats(findings: Finding[]): EvidenceStats {
  let total = 0;
  let unverifiable = 0;
  let unsupportedFindings = 0;

  for (const f of findings) {
    if (f.evidence.length === 0) {
      unsupportedFindings++;
      continue;
    }
    for (const e of f.evidence) {
      total++;
      if (e.verificationStatus === 'unverifiable') {
        unverifiable++;
      }
    }
  }

  return { total, unverifiable, unsupportedFindings };
}

function checkHallucinationFree(findings: Finding[]): boolean {
  const stats = countEvidenceStats(findings);
  return stats.unverifiable === 0;
}

function checkConfidencePass(findings: Finding[]): boolean {
  if (findings.length === 0) return true;
  const lowConfidence = findings.filter(f => (f.confidence ?? 10) <= 3).length;
  return (lowConfidence / findings.length) < 0.2;
}

function checkSectionsPopulated(briefMarkdown: string): boolean {
  const sections = briefMarkdown.split(/^## /m).slice(1);
  if (sections.length === 0) return false;
  return sections.every(s => s.replace(/^[^\n]*\n/, '').trim().length > 10);
}

function checkScorecardComplete(categories: Array<{ category: string; score: string }>): boolean {
  if (categories.length === 0) return false;
  return categories.every(c => c.score !== 'unknown' && c.category !== 'unknown');
}

// ─── Helpers ───

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'TEST-001',
    category: 'security',
    severity: 'high',
    title: 'Test finding',
    description: 'A test',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

// ─── countEvidenceStats ───

describe('countEvidenceStats', () => {
  it('returns zeroes for empty findings', () => {
    expect(countEvidenceStats([])).toEqual({ total: 0, unverifiable: 0, unsupportedFindings: 0 });
  });

  it('counts findings with no evidence as unsupported', () => {
    const findings = [makeFinding(), makeFinding({ id: 'TEST-002' })];
    const stats = countEvidenceStats(findings);
    expect(stats.unsupportedFindings).toBe(2);
    expect(stats.total).toBe(0);
  });

  it('counts evidence items and unverifiable separately', () => {
    const findings = [
      makeFinding({
        evidence: [
          { filePath: 'a.ts', snippet: 'x', description: 'd', verificationStatus: 'verified' },
          { filePath: 'b.ts', snippet: 'x', description: 'd', verificationStatus: 'unverifiable' },
          { filePath: 'c.ts', snippet: 'x', description: 'd', verificationStatus: 'corrected' },
        ],
      }),
    ];
    const stats = countEvidenceStats(findings);
    expect(stats.total).toBe(3);
    expect(stats.unverifiable).toBe(1);
    expect(stats.unsupportedFindings).toBe(0);
  });

  it('counts mixed findings (some with evidence, some without)', () => {
    const findings = [
      makeFinding({
        evidence: [
          { filePath: 'a.ts', snippet: 'x', description: 'd', verificationStatus: 'unverifiable' },
        ],
      }),
      makeFinding({ id: 'TEST-002' }), // no evidence
    ];
    const stats = countEvidenceStats(findings);
    expect(stats.total).toBe(1);
    expect(stats.unverifiable).toBe(1);
    expect(stats.unsupportedFindings).toBe(1);
  });

  it('treats evidence without verificationStatus as not unverifiable', () => {
    const findings = [
      makeFinding({
        evidence: [{ filePath: 'a.ts', snippet: 'x', description: 'd' }],
      }),
    ];
    const stats = countEvidenceStats(findings);
    expect(stats.total).toBe(1);
    expect(stats.unverifiable).toBe(0);
  });
});

// ─── checkHallucinationFree ───

describe('checkHallucinationFree', () => {
  it('passes for empty findings', () => {
    expect(checkHallucinationFree([])).toBe(true);
  });

  it('passes when all evidence is verified', () => {
    const findings = [
      makeFinding({
        evidence: [
          { filePath: 'a.ts', snippet: 'x', description: 'd', verificationStatus: 'verified' },
          { filePath: 'b.ts', snippet: 'x', description: 'd', verificationStatus: 'corrected' },
        ],
      }),
    ];
    expect(checkHallucinationFree(findings)).toBe(true);
  });

  it('fails when any evidence is unverifiable', () => {
    const findings = [
      makeFinding({
        evidence: [
          { filePath: 'a.ts', snippet: 'x', description: 'd', verificationStatus: 'verified' },
          { filePath: 'b.ts', snippet: 'x', description: 'd', verificationStatus: 'unverifiable' },
        ],
      }),
    ];
    expect(checkHallucinationFree(findings)).toBe(false);
  });

  it('passes for findings with no evidence (unsupported but not hallucinated)', () => {
    const findings = [makeFinding()];
    expect(checkHallucinationFree(findings)).toBe(true);
  });
});

// ─── checkConfidencePass ───

describe('checkConfidencePass', () => {
  it('passes for empty findings', () => {
    expect(checkConfidencePass([])).toBe(true);
  });

  it('passes when all findings have high confidence', () => {
    const findings = [
      makeFinding({ confidence: 8 }),
      makeFinding({ id: 'T2', confidence: 9 }),
      makeFinding({ id: 'T3', confidence: 10 }),
    ];
    expect(checkConfidencePass(findings)).toBe(true);
  });

  it('passes when fewer than 20% have low confidence', () => {
    // 1 out of 6 = 16.7% < 20%
    const findings = [
      makeFinding({ confidence: 2 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeFinding({ id: `HIGH-${i}`, confidence: 8 }),
      ),
    ];
    expect(checkConfidencePass(findings)).toBe(true);
  });

  it('fails when 20% or more have low confidence', () => {
    // 1 out of 5 = 20% — not strictly less than 20%
    const findings = [
      makeFinding({ confidence: 3 }),
      ...Array.from({ length: 4 }, (_, i) =>
        makeFinding({ id: `HIGH-${i}`, confidence: 8 }),
      ),
    ];
    expect(checkConfidencePass(findings)).toBe(false);
  });

  it('treats missing confidence as 10 (high)', () => {
    const findings = [
      makeFinding(), // no confidence → defaults to 10
      makeFinding({ id: 'T2' }),
    ];
    expect(checkConfidencePass(findings)).toBe(true);
  });

  it('treats confidence=3 as low (boundary)', () => {
    // All 5 have confidence=3 → 100% low → fails
    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ id: `LOW-${i}`, confidence: 3 }),
    );
    expect(checkConfidencePass(findings)).toBe(false);
  });

  it('treats confidence=4 as not low (boundary)', () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ id: `MID-${i}`, confidence: 4 }),
    );
    expect(checkConfidencePass(findings)).toBe(true);
  });
});

// ─── checkSectionsPopulated ───

describe('checkSectionsPopulated', () => {
  it('fails for empty string', () => {
    expect(checkSectionsPopulated('')).toBe(false);
  });

  it('fails for markdown with no ## headings', () => {
    expect(checkSectionsPopulated('# Top heading\nSome content.')).toBe(false);
  });

  it('passes for well-populated sections', () => {
    const md = `# Brief

## Architecture
This section covers the overall architecture of the project.

## Dependencies
The project has well-managed dependencies with no critical issues.
`;
    expect(checkSectionsPopulated(md)).toBe(true);
  });

  it('fails when any section has too little content', () => {
    const md = `## Architecture
Detailed architecture analysis with plenty of content.

## Dependencies
Short.
`;
    expect(checkSectionsPopulated(md)).toBe(false);
  });

  it('fails when section has only whitespace after heading', () => {
    const md = `## Architecture



## Dependencies
Detailed dependency analysis with good coverage.
`;
    expect(checkSectionsPopulated(md)).toBe(false);
  });

  it('passes with preamble before first section', () => {
    const md = `This is a preamble that should be ignored.

## Security
This section covers security concerns found during the audit.
`;
    expect(checkSectionsPopulated(md)).toBe(true);
  });
});

// ─── checkScorecardComplete ───

describe('checkScorecardComplete', () => {
  it('fails for empty categories', () => {
    expect(checkScorecardComplete([])).toBe(false);
  });

  it('passes when all categories are scored', () => {
    const cats = [
      { category: 'security', score: 'red' },
      { category: 'dependencies', score: 'green' },
      { category: 'architecture', score: 'yellow' },
    ];
    expect(checkScorecardComplete(cats)).toBe(true);
  });

  it('fails when any score is "unknown"', () => {
    const cats = [
      { category: 'security', score: 'green' },
      { category: 'dependencies', score: 'unknown' },
    ];
    expect(checkScorecardComplete(cats)).toBe(false);
  });

  it('fails when any category name is "unknown"', () => {
    const cats = [
      { category: 'unknown', score: 'green' },
      { category: 'security', score: 'red' },
    ];
    expect(checkScorecardComplete(cats)).toBe(false);
  });

  it('passes with a single valid category', () => {
    expect(checkScorecardComplete([{ category: 'security', score: 'green' }])).toBe(true);
  });
});
