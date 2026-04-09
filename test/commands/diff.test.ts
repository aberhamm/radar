import { describe, it, expect } from 'vitest';
import { diffFindings } from '../../src/commands/diff.js';
import type { Finding } from '../../src/types/findings.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: 'high',
    title: 'Exposed API Key',
    description: 'API key found',
    evidence: [{ filePath: 'src/config.ts', lineNumber: 42, snippet: 'key', description: 'key' }],
    tags: ['security'],
    ...overrides,
  };
}

describe('diffFindings', () => {
  it('identifies new findings', () => {
    const prev: Finding[] = [];
    const curr = [makeFinding({ fingerprint: 'fp-001' })];

    const result = diffFindings(prev, curr);
    expect(result.newFindings).toHaveLength(1);
    expect(result.resolvedFindings).toHaveLength(0);
    expect(result.persistentFindings).toHaveLength(0);
    expect(result.summary).toContain('+1 new');
  });

  it('identifies resolved findings', () => {
    const prev = [makeFinding({ fingerprint: 'fp-001' })];
    const curr: Finding[] = [];

    const result = diffFindings(prev, curr);
    expect(result.newFindings).toHaveLength(0);
    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.persistentFindings).toHaveLength(0);
    expect(result.summary).toContain('-1 resolved');
  });

  it('identifies persistent findings', () => {
    const prev = [makeFinding({ fingerprint: 'fp-001' })];
    const curr = [makeFinding({ fingerprint: 'fp-001', description: 'Updated description' })];

    const result = diffFindings(prev, curr);
    expect(result.newFindings).toHaveLength(0);
    expect(result.resolvedFindings).toHaveLength(0);
    expect(result.persistentFindings).toHaveLength(1);
    expect(result.summary).toContain('1 persistent');
  });

  it('handles mix of new, resolved, and persistent', () => {
    const prev = [
      makeFinding({ id: 'F-001', fingerprint: 'fp-001' }),
      makeFinding({ id: 'F-002', fingerprint: 'fp-002' }),
    ];
    const curr = [
      makeFinding({ id: 'F-001', fingerprint: 'fp-001' }), // persistent
      makeFinding({ id: 'F-003', fingerprint: 'fp-003' }), // new
    ];

    const result = diffFindings(prev, curr);
    expect(result.newFindings).toHaveLength(1);
    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.persistentFindings).toHaveLength(1);
  });

  it('uses fallback fingerprint when fingerprint field is missing', () => {
    // Same category + filePath + title → same fallback fingerprint
    const prev = [makeFinding({ id: 'F-001' })]; // no fingerprint field
    const curr = [makeFinding({ id: 'F-001-new' })]; // same data, no fingerprint

    const result = diffFindings(prev, curr);
    // Should be persistent since fallback hash matches
    expect(result.persistentFindings).toHaveLength(1);
    expect(result.newFindings).toHaveLength(0);
  });

  it('fallback fingerprint differs when title changes', () => {
    const prev = [makeFinding({ title: 'Old Title' })];
    const curr = [makeFinding({ title: 'New Title' })];

    const result = diffFindings(prev, curr);
    expect(result.newFindings).toHaveLength(1);
    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.persistentFindings).toHaveLength(0);
  });

  it('fallback fingerprint is case-insensitive for title', () => {
    const prev = [makeFinding({ title: 'Exposed API Key' })];
    const curr = [makeFinding({ title: 'exposed api key' })];

    const result = diffFindings(prev, curr);
    expect(result.persistentFindings).toHaveLength(1);
  });

  it('returns "No changes" summary when both lists are empty', () => {
    const result = diffFindings([], []);
    expect(result.summary).toBe('No changes');
  });

  it('normalizes backslash paths in fallback fingerprint', () => {
    const prev = [makeFinding({ evidence: [{ filePath: 'src\\config.ts', lineNumber: 1, snippet: '', description: '' }] })];
    const curr = [makeFinding({ evidence: [{ filePath: 'src/config.ts', lineNumber: 1, snippet: '', description: '' }] })];

    const result = diffFindings(prev, curr);
    expect(result.persistentFindings).toHaveLength(1);
  });
});
