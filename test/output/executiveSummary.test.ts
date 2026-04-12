import { describe, it, expect } from 'vitest';
import { renderExecutiveSummary } from '../../src/output/executiveSummary.js';
import type { Scorecard, RunMetrics, CategoryScore, ScoreLevel } from '../../src/types/output.js';
import type { Finding } from '../../src/types/findings.js';

function makeFinding(overrides: Partial<Finding>): Finding {
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

function makeCategory(overrides: Partial<CategoryScore>): CategoryScore {
  return {
    category: 'security',
    score: 'green',
    findings: [],
    summary: 'Security: no issues',
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<Scorecard>): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'audit',
    generatedAt: new Date().toISOString(),
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

function makeMetrics(overrides: Partial<RunMetrics>): RunMetrics {
  return {
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 120_000,
    toolCalls: 45,
    models: {},
    totalEstimatedCostUsd: 0.74,
    ...overrides,
  };
}

describe('renderExecutiveSummary', () => {
  it('renders green overall verdict', () => {
    const sc = makeScorecard({ overallScore: 'green' });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('## Executive Summary');
    expect(md).toContain('**Overall: GREEN**');
    expect(md).toContain('All 3 categories are healthy');
  });

  it('renders yellow verdict with category count', () => {
    const sc = makeScorecard({
      overallScore: 'yellow',
      categories: [
        makeCategory({ category: 'security', score: 'yellow' }),
        makeCategory({ category: 'dependencies', score: 'green' }),
        makeCategory({ category: 'architecture', score: 'green' }),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**Overall: YELLOW**');
    expect(md).toContain('1 of 3 categories have issues');
  });

  it('renders red verdict with category count', () => {
    const sc = makeScorecard({
      overallScore: 'red',
      categories: [
        makeCategory({ category: 'security', score: 'red' }),
        makeCategory({ category: 'dependencies', score: 'red' }),
        makeCategory({ category: 'architecture', score: 'green' }),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**Overall: RED**');
    expect(md).toContain('2 of 3 categories have critical issues');
  });

  it('renders severity breakdown', () => {
    const findings = [
      makeFinding({ id: 'A', severity: 'critical' }),
      makeFinding({ id: 'B', severity: 'high' }),
      makeFinding({ id: 'C', severity: 'medium' }),
      makeFinding({ id: 'D', severity: 'low' }),
      makeFinding({ id: 'E', severity: 'info' }),
    ];
    const sc = makeScorecard({
      overallScore: 'red',
      categories: [makeCategory({ findings, score: 'red' })],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**5 findings:**');
    expect(md).toContain('**1 critical**');
    expect(md).toContain('**1 high**');
    expect(md).toContain('1 medium');
    expect(md).toContain('1 low');
    expect(md).toContain('1 informational');
  });

  it('renders zero findings', () => {
    const sc = makeScorecard({ overallScore: 'green' });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**0 findings**');
  });

  it('renders top 3 risks', () => {
    const risks = [
      makeFinding({ id: 'R1', severity: 'critical', title: 'SQL injection in API' }),
      makeFinding({ id: 'R2', severity: 'high', title: 'Missing auth middleware' }),
      makeFinding({ id: 'R3', severity: 'high', title: 'Outdated dependencies' }),
      makeFinding({ id: 'R4', severity: 'medium', title: 'Fourth risk should not appear' }),
    ];
    const sc = makeScorecard({ topRisks: risks });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**Top risks:**');
    expect(md).toContain('1. **SQL injection in API** (critical)');
    expect(md).toContain('2. **Missing auth middleware** (high)');
    expect(md).toContain('3. **Outdated dependencies** (high)');
    expect(md).not.toContain('Fourth risk');
  });

  it('omits top risks section when none exist', () => {
    const sc = makeScorecard({ topRisks: [] });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).not.toContain('**Top risks:**');
  });

  it('renders strengths from green categories', () => {
    const sc = makeScorecard({
      overallScore: 'yellow',
      categories: [
        makeCategory({ category: 'security', score: 'yellow' }),
        makeCategory({ category: 'dependencies', score: 'green', findings: [] }),
        makeCategory({ category: 'architecture', score: 'green', findings: [
          makeFinding({ severity: 'low' }),
        ]}),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**Strengths:**');
    expect(md).toContain('Dependencies');
    expect(md).toContain('no issues found');
    expect(md).toContain('Architecture');
    expect(md).toContain('1 minor finding');
  });

  it('omits strengths section when no green categories', () => {
    const sc = makeScorecard({
      overallScore: 'red',
      categories: [
        makeCategory({ category: 'security', score: 'red' }),
        makeCategory({ category: 'dependencies', score: 'yellow' }),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).not.toContain('**Strengths:**');
  });

  it('limits strengths to 3', () => {
    const sc = makeScorecard({
      categories: [
        makeCategory({ category: 'security', score: 'green' }),
        makeCategory({ category: 'dependencies', score: 'green' }),
        makeCategory({ category: 'architecture', score: 'green' }),
        makeCategory({ category: 'deployment', score: 'green' }),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    const strengthLines = md.split('\n').filter(l => l.startsWith('- '));
    expect(strengthLines.length).toBe(3);
  });

  it('renders investigation scope with duration and cost', () => {
    const md = renderExecutiveSummary(
      makeScorecard({}),
      makeMetrics({ toolCalls: 38, durationMs: 480_000, totalEstimatedCostUsd: 1.23 }),
    );

    expect(md).toContain('38 tool calls');
    expect(md).toContain('8m');
    expect(md).toContain('~$1.23');
  });

  it('formats short durations in seconds', () => {
    const md = renderExecutiveSummary(
      makeScorecard({}),
      makeMetrics({ durationMs: 45_000 }),
    );

    expect(md).toContain('45s');
  });

  it('truncates long risk descriptions', () => {
    const longDesc = 'A'.repeat(200);
    const sc = makeScorecard({
      topRisks: [makeFinding({ title: 'Long risk', description: longDesc })],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('...');
    expect(md).not.toContain('A'.repeat(200));
  });

  it('handles all-red categories scorecard', () => {
    const sc = makeScorecard({
      overallScore: 'red',
      categories: [
        makeCategory({ category: 'security', score: 'red', findings: [
          makeFinding({ severity: 'critical' }),
          makeFinding({ id: 'B', severity: 'critical' }),
        ]}),
        makeCategory({ category: 'dependencies', score: 'red', findings: [
          makeFinding({ id: 'C', severity: 'high' }),
          makeFinding({ id: 'D', severity: 'high' }),
          makeFinding({ id: 'E', severity: 'high' }),
        ]}),
      ],
      topRisks: [
        makeFinding({ severity: 'critical', title: 'Top risk' }),
      ],
    });
    const md = renderExecutiveSummary(sc, makeMetrics({}));

    expect(md).toContain('**Overall: RED**');
    expect(md).toContain('**5 findings:**');
    expect(md).toContain('**2 critical**');
    expect(md).toContain('**3 high**');
    expect(md).not.toContain('**Strengths:**');
  });
});
