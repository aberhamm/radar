import { describe, it, expect } from 'vitest';
import { deduplicateFindings } from '../../../src/tools/analysis/deduplicateFindings.js';
import type { Finding } from '../../../src/types/findings.js';

function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'id'>): Finding {
  return {
    category: 'dependencies',
    severity: 'medium',
    title: 'Test finding',
    description: 'Test description',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

describe('deduplicateFindings', () => {
  it('returns empty array unchanged', () => {
    const result = deduplicateFindings([]);
    expect(result.findings).toEqual([]);
    expect(result.mergedCount).toBe(0);
  });

  it('returns single finding unchanged', () => {
    const findings = [makeFinding({ id: 'F1' })];
    const result = deduplicateFindings(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.mergedCount).toBe(0);
  });

  it('merges two findings with same category, severity, and overlapping evidence', () => {
    const f1 = makeFinding({
      id: 'DEP-001',
      title: 'Core dependencies behind latest',
      description: 'Short description.',
      evidence: [
        { filePath: 'package.json', lineNumber: 20, snippet: 'jss 21.6.0', description: 'JSS behind' },
        { filePath: 'package.json', lineNumber: 16, snippet: 'next 14.1.0', description: 'Next behind' },
      ],
    });
    const f2 = makeFinding({
      id: 'DEP-002',
      title: 'Dependencies behind; no testing libraries',
      description: 'A longer description that provides more detail about the same issue.',
      evidence: [
        { filePath: 'package.json', lineNumber: 20, snippet: 'jss 21.6.0', description: 'JSS behind' },
        { filePath: 'package.json', lineNumber: 25, snippet: 'no test lib', description: 'No tests' },
      ],
    });

    const result = deduplicateFindings([f1, f2]);
    expect(result.findings).toHaveLength(1);
    expect(result.mergedCount).toBe(1);
    // Should keep the longer description
    expect(result.findings[0].description).toContain('longer description');
    // Should combine evidence (3 unique, 1 deduped)
    expect(result.findings[0].evidence).toHaveLength(3);
  });

  it('does not merge findings with different categories', () => {
    const f1 = makeFinding({
      id: 'SEC-001',
      category: 'security',
      evidence: [{ filePath: 'middleware.ts', lineNumber: 5, snippet: 'code', description: 'desc' }],
    });
    const f2 = makeFinding({
      id: 'DEP-001',
      category: 'dependencies',
      evidence: [{ filePath: 'middleware.ts', lineNumber: 5, snippet: 'code', description: 'desc' }],
    });

    const result = deduplicateFindings([f1, f2]);
    expect(result.findings).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it('does not merge findings with different severities', () => {
    const f1 = makeFinding({
      id: 'DEP-001',
      severity: 'high',
      evidence: [{ filePath: 'package.json', lineNumber: 1, snippet: 'code', description: 'desc' }],
    });
    const f2 = makeFinding({
      id: 'DEP-002',
      severity: 'medium',
      evidence: [{ filePath: 'package.json', lineNumber: 1, snippet: 'code', description: 'desc' }],
    });

    const result = deduplicateFindings([f1, f2]);
    expect(result.findings).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it('does not merge findings with low evidence overlap', () => {
    const f1 = makeFinding({
      id: 'SEC-001',
      evidence: [
        { filePath: 'middleware.ts', lineNumber: 5, snippet: 'code', description: 'desc' },
        { filePath: 'auth.ts', lineNumber: 1, snippet: 'code', description: 'desc' },
      ],
    });
    const f2 = makeFinding({
      id: 'SEC-002',
      evidence: [
        { filePath: 'config.ts', lineNumber: 1, snippet: 'code', description: 'desc' },
        { filePath: 'env.ts', lineNumber: 1, snippet: 'code', description: 'desc' },
      ],
    });

    const result = deduplicateFindings([f1, f2]);
    expect(result.findings).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it('unions tags when merging', () => {
    const f1 = makeFinding({
      id: 'DEP-001',
      tags: ['jss', 'nextjs'],
      evidence: [{ filePath: 'package.json', lineNumber: 1, snippet: 'code', description: 'desc' }],
    });
    const f2 = makeFinding({
      id: 'DEP-002',
      tags: ['nextjs', 'react'],
      evidence: [{ filePath: 'package.json', lineNumber: 1, snippet: 'code', description: 'desc' }],
    });

    const result = deduplicateFindings([f1, f2]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].tags).toEqual(expect.arrayContaining(['jss', 'nextjs', 'react']));
  });
});
