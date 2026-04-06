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

  it('security-review scorecard has 6 categories', () => {
    const sc = computeScorecard('test-repo', 'security-review', []);
    expect(sc.overallScore).toBe('green');
    expect(sc.categories.length).toBe(6);
    expect(sc.topRisks).toEqual([]);
  });

  it('nextjs scorecard has 7 categories', () => {
    const sc = computeScorecard('test-repo', 'nextjs', []);
    expect(sc.overallScore).toBe('green');
    expect(sc.categories.length).toBe(7);
  });

  it('nextjs scorecard has framework-specific category names', () => {
    const sc = computeScorecard('test-repo', 'nextjs', []);
    const primaryCategories = sc.categories.map((c) => c.category);
    expect(primaryCategories).toContain('routing');
    expect(primaryCategories).toContain('data-fetching');
    expect(primaryCategories).toContain('performance');
    expect(primaryCategories).toContain('configuration');
    expect(primaryCategories).toContain('dependencies');
  });

  it('nextjs scorecard scores findings in performance category', () => {
    const findings = [makeFinding({ severity: 'high', category: 'performance' })];
    const sc = computeScorecard('test-repo', 'nextjs', findings);
    const perfCat = sc.categories.find((c) => c.category === 'performance');
    expect(perfCat?.score).toBe('yellow');
  });

  it('accessibility scorecard has 6 categories', () => {
    const sc = computeScorecard('test-repo', 'accessibility', []);
    expect(sc.overallScore).toBe('green');
    expect(sc.categories.length).toBe(6);
  });

  it('accessibility scorecard scores findings in a11y categories', () => {
    const findings = [
      makeFinding({ severity: 'critical', category: 'accessibility' }),
      makeFinding({ id: 'F-002', severity: 'high', category: 'forms' }),
    ];
    const sc = computeScorecard('test-repo', 'accessibility', findings);
    expect(sc.overallScore).toBe('red');
  });

  it('accessibility scorecard maps aria findings to Dynamic Content', () => {
    const findings = [makeFinding({ severity: 'medium', category: 'aria' })];
    const sc = computeScorecard('test-repo', 'accessibility', findings);
    // Dynamic Content maps to ['aria', 'accessibility']
    const dynamicCat = sc.categories.find((c) => c.category === 'aria');
    expect(dynamicCat).toBeDefined();
    expect(dynamicCat?.findings.length).toBe(1);
  });

  it('excludes very low confidence findings (1-2) from scoring', () => {
    const findings = [
      makeFinding({ id: 'LOW-CONF', severity: 'critical', category: 'security', confidence: 2 }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    // Critical finding with confidence 2 should be excluded → still green
    expect(sc.overallScore).toBe('green');
    expect(sc.topRisks).toHaveLength(0);
  });

  it('includes findings with confidence 3+ in scoring', () => {
    const findings = [
      makeFinding({ id: 'MED-CONF', severity: 'critical', category: 'security', confidence: 3 }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.overallScore).toBe('red');
  });

  it('treats missing confidence as 7 (included in scoring)', () => {
    const findings = [
      makeFinding({ id: 'NO-CONF', severity: 'high', category: 'security' }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.overallScore).toBe('yellow');
  });

  it('uses confidence as tiebreaker in topRisks', () => {
    const findings = [
      makeFinding({ id: 'LOW-CONF', severity: 'high', category: 'security', confidence: 5 }),
      makeFinding({ id: 'HIGH-CONF', severity: 'high', category: 'dependencies', confidence: 9 }),
    ];
    const sc = computeScorecard('test-repo', 'audit', findings);
    expect(sc.topRisks[0].id).toBe('HIGH-CONF');
    expect(sc.topRisks[1].id).toBe('LOW-CONF');
  });

  it('security-review scorecard has security-specific category names', () => {
    const sc = computeScorecard('test-repo', 'security-review', []);
    const primaryCategories = sc.categories.map((c) => c.category);
    // First category maps to 'security'
    expect(primaryCategories[0]).toBe('security');
    // Third category maps to 'configuration' (Security Headers)
    expect(primaryCategories[2]).toBe('configuration');
    // Fourth category maps to 'dependencies' (Dependency Security)
    expect(primaryCategories[3]).toBe('dependencies');
    // Fifth category maps to 'security' (Input Validation)
    expect(primaryCategories[4]).toBe('security');
  });
});
