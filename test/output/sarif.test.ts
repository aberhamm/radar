import { describe, it, expect } from 'vitest';
import { generateSarif } from '../../src/output/sarif.js';
import type { Finding } from '../../src/types/findings.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: 'high',
    title: 'Exposed API Key',
    description: 'API key found in source code',
    evidence: [{ filePath: 'src/config.ts', lineNumber: 42, snippet: 'key=abc', description: 'key' }],
    tags: ['security'],
    ...overrides,
  };
}

describe('generateSarif', () => {
  it('generates valid SARIF 2.1.0 structure', () => {
    const sarif = generateSarif([makeFinding()]);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-schema-2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('Radar');
  });

  it('maps critical/high to error level', () => {
    const sarif = generateSarif([
      makeFinding({ id: 'F-001', severity: 'critical' }),
      makeFinding({ id: 'F-002', severity: 'high' }),
    ]);
    expect(sarif.runs[0].results[0].level).toBe('error');
    expect(sarif.runs[0].results[1].level).toBe('error');
  });

  it('maps medium to warning level', () => {
    const sarif = generateSarif([makeFinding({ severity: 'medium' })]);
    expect(sarif.runs[0].results[0].level).toBe('warning');
  });

  it('maps low/info to note level', () => {
    const sarif = generateSarif([
      makeFinding({ id: 'F-001', severity: 'low' }),
      makeFinding({ id: 'F-002', severity: 'info' }),
    ]);
    expect(sarif.runs[0].results[0].level).toBe('note');
    expect(sarif.runs[0].results[1].level).toBe('note');
  });

  it('skips findings without filePath', () => {
    const sarif = generateSarif([
      makeFinding(),
      makeFinding({ id: 'F-002', evidence: [] }), // No evidence
      makeFinding({
        id: 'F-003',
        evidence: [{ filePath: '', lineNumber: 1, snippet: '', description: '' }],
      }), // Empty filePath
    ]);
    // Only the first finding has a valid filePath
    expect(sarif.runs[0].results).toHaveLength(1);
  });

  it('includes fingerprint when present', () => {
    const sarif = generateSarif([makeFinding({ fingerprint: 'abc123hash' })]);
    expect(sarif.runs[0].results[0].fingerprints).toEqual({ 'radar/v1': 'abc123hash' });
  });

  it('omits fingerprints field when no fingerprint', () => {
    const sarif = generateSarif([makeFinding()]);
    expect(sarif.runs[0].results[0].fingerprints).toBeUndefined();
  });

  it('normalizes backslash paths to forward slashes', () => {
    const sarif = generateSarif([
      makeFinding({
        evidence: [{ filePath: 'src\\config\\keys.ts', lineNumber: 10, snippet: '', description: '' }],
      }),
    ]);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri)
      .toBe('src/config/keys.ts');
  });

  it('returns empty results for empty findings', () => {
    const sarif = generateSarif([]);
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
  });

  it('uses default line 1 when lineNumber is missing', () => {
    const sarif = generateSarif([
      makeFinding({
        evidence: [{ filePath: 'src/test.ts', snippet: 'test', description: 'test' }],
      }),
    ]);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(1);
  });
});
