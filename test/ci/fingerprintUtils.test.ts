import { describe, it, expect } from 'vitest';
import { computeFingerprint, getFingerprint } from '../../src/ci/fingerprintUtils.js';
import type { Finding, Evidence } from '../../src/types/findings.js';

function makeEvidence(filePath: string): Evidence {
  return { filePath, snippet: 'x', description: 'test' };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: 'high',
    title: 'Exposed API Key',
    description: 'desc',
    evidence: [makeEvidence('src/config.ts')],
    tags: [],
    ...overrides,
  };
}

describe('computeFingerprint', () => {
  it('produces a stable 64-char hex hash', () => {
    const fp = computeFingerprint('security', 'Exposed API Key', [makeEvidence('src/config.ts')]);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
    // Same inputs → same output
    const fp2 = computeFingerprint('security', 'Exposed API Key', [makeEvidence('src/config.ts')]);
    expect(fp2).toBe(fp);
  });

  it('normalizes title casing and whitespace', () => {
    const fp1 = computeFingerprint('security', 'Exposed API Key', [makeEvidence('src/config.ts')]);
    const fp2 = computeFingerprint('security', '  exposed   api   key  ', [makeEvidence('src/config.ts')]);
    expect(fp1).toBe(fp2);
  });

  it('normalizes backslashes in file paths', () => {
    const fp1 = computeFingerprint('security', 'title', [makeEvidence('src/config.ts')]);
    const fp2 = computeFingerprint('security', 'title', [makeEvidence('src\\config.ts')]);
    expect(fp1).toBe(fp2);
  });

  it('differs when category changes', () => {
    const fp1 = computeFingerprint('security', 'title', [makeEvidence('src/config.ts')]);
    const fp2 = computeFingerprint('dependencies', 'title', [makeEvidence('src/config.ts')]);
    expect(fp1).not.toBe(fp2);
  });

  it('handles empty evidence array', () => {
    const fp = computeFingerprint('security', 'title', []);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('getFingerprint', () => {
  it('returns stored fingerprint when present', () => {
    const finding = makeFinding({ fingerprint: 'abc123stored' });
    expect(getFingerprint(finding)).toBe('abc123stored');
  });

  it('computes fallback when fingerprint is missing', () => {
    const finding = makeFinding({ fingerprint: undefined });
    const fp = getFingerprint(finding);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes fallback when fingerprint is empty string', () => {
    const finding = makeFinding({ fingerprint: '' });
    const fp = getFingerprint(finding);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fallback matches computeFingerprint for same data', () => {
    const finding = makeFinding({ fingerprint: undefined });
    const fallback = getFingerprint(finding);
    const direct = computeFingerprint(finding.category, finding.title, finding.evidence);
    expect(fallback).toBe(direct);
  });
});
