import { describe, it, expect } from 'vitest';
import { computeScorecard } from '../../src/output/scorecard.js';
import type { Finding } from '../../src/types/findings.js';

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: 'TEST-001',
    category: 'security',
    severity: 'medium',
    title: 'Test finding',
    description: 'A test',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

describe('computeScorecard', () => {
  it('scores green with no findings', () => {
    const sc = computeScorecard('test-repo', 'onboarding', []);
    expect(sc.overallScore).toBe('green');
    expect(sc.categories.length).toBe(7);
    expect(sc.topRisks).toEqual([]);
  });

  it('scores yellow with a high finding', () => {
    const findings = [makeFinding({ severity: 'high', category: 'security' })];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.overallScore).toBe('yellow');
  });

  it('scores red with a critical finding', () => {
    const findings = [makeFinding({ severity: 'critical', category: 'dependencies' })];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.overallScore).toBe('red');
  });

  it('scores red with 3+ high findings in one category', () => {
    const findings = [
      makeFinding({ id: 'A', severity: 'high', category: 'security' }),
      makeFinding({ id: 'B', severity: 'high', category: 'security' }),
      makeFinding({ id: 'C', severity: 'high', category: 'security' }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    // Security & Configuration category should be red
    const secCat = sc.categories.find((c) => c.category === 'security');
    expect(secCat?.score).toBe('red');
  });

  it('ranks top risks by severity', () => {
    const findings = [
      makeFinding({ id: 'LOW', severity: 'low', category: 'stack' }),
      makeFinding({ id: 'HIGH', severity: 'high', category: 'dependencies' }),
      makeFinding({ id: 'MED', severity: 'medium', category: 'routing' }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.topRisks[0].id).toBe('HIGH');
    expect(sc.topRisks[1].id).toBe('MED');
    expect(sc.topRisks[2].id).toBe('LOW');
  });

  it('limits top risks to 5', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ id: `F-${i}`, severity: 'medium', category: 'security' }),
    );
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.topRisks.length).toBe(5);
  });
});
