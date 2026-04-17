import { describe, it, expect } from 'vitest';
import {
  renderMultiGoalSummary,
  scoreEmoji,
  goalDisplayName,
  type MultiGoalResult,
  type MultiGoalMetrics,
} from '../../src/output/multiGoalSummary.js';
import type { Finding } from '../../src/types/findings.js';
import type { Scorecard, CategoryScore, ScoreLevel, RankedRisk, FindingCount, ScorecardMetadata } from '../../src/types/output.js';

const ZERO_COUNTS: FindingCount = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'stack',
    severity: 'medium',
    title: 'Test finding',
    description: 'A test finding for unit tests',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

function makeRankedRisk(overrides: Partial<RankedRisk> = {}): RankedRisk {
  return {
    rank: 1,
    findingId: 'F-001',
    title: 'Test risk',
    severity: 'medium',
    businessContext: 'A test finding for unit tests',
    recommendation: 'Fix it',
    ...overrides,
  };
}

function makeMetadata(overrides?: Partial<ScorecardMetadata>): ScorecardMetadata {
  return {
    repoName: 'test-repo',
    analysisDate: '2026-01-01T00:00:00Z',
    agentVersion: '1.0.0',
    goalType: 'onboarding',
    detectedPlatform: 'auto',
    toolCallsUsed: 0,
    webSearchesUsed: 0,
    urlFetchesUsed: 0,
    documentationSources: [],
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryScore> = {}): CategoryScore {
  return {
    category: 'stack',
    score: 'green',
    findings: [],
    findingCount: { ...ZERO_COUNTS },
    keyFindings: [],
    summary: 'OK',
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    metadata: makeMetadata({ goalType: overrides.goalType ?? 'onboarding' }),
    repoName: 'test-repo',
    goalType: 'onboarding',
    generatedAt: '2026-01-01T00:00:00Z',
    overallScore: 'green',
    categories: [makeCategory()],
    topRisks: [],
    findings: [],
    ...overrides,
  };
}

function makeResult(goal: string, overrides: Partial<MultiGoalResult> = {}): MultiGoalResult {
  return {
    goal: goal as any,
    scorecard: makeScorecard({ goalType: goal }),
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<MultiGoalMetrics> = {}): MultiGoalMetrics {
  return {
    totalToolCalls: 100,
    totalDurationMs: 30000,
    totalCostUsd: 0.50,
    passBreakdown: [
      { pass: 'Core', toolCalls: 70, budget: 70, durationMs: 20000, terminationReason: 'completed' },
      { pass: 'Next.js Specialist', toolCalls: 15, budget: 15, durationMs: 5000, terminationReason: 'completed' },
      { pass: 'Accessibility Specialist', toolCalls: 15, budget: 15, durationMs: 5000, terminationReason: 'completed' },
    ],
    ...overrides,
  };
}

describe('renderMultiGoalSummary', () => {
  it('renders complete summary with header, matrix, risks, and distribution', () => {
    const results = [
      makeResult('onboarding', { briefPath: './onboarding/brief.md' }),
      makeResult('audit', {
        scorecard: makeScorecard({
          goalType: 'audit',
          overallScore: 'yellow',
          categories: [
            makeCategory({ category: 'stack', score: 'yellow', findings: [makeFinding()] }),
            makeCategory({ category: 'security', score: 'green' }),
          ],
          topRisks: [makeRankedRisk({ rank: 1, findingId: 'R-001', severity: 'high', title: 'Risk one', businessContext: 'Important risk' })],
        }),
      }),
    ];
    const findings = [
      makeFinding({ category: 'stack', severity: 'high' }),
      makeFinding({ id: 'F-002', category: 'security', severity: 'medium' }),
      makeFinding({ id: 'F-003', category: 'stack', severity: 'info' }),
    ];

    const md = renderMultiGoalSummary('test-repo', results, findings, makeMetrics());

    // Header
    expect(md).toContain('# Universal Analysis: test-repo');
    expect(md).toContain('**Mode:** Universal (all goals)');
    expect(md).toContain('**Findings:** 3 total');
    expect(md).toContain('**Tool calls:** 100');

    // Pass breakdown table — now includes budget and status columns
    expect(md).toContain('| Core | 70/70 | 70 | 20.0s | ✓ |');
    expect(md).toContain('| Next.js Specialist | 15/15 | 15 | 5.0s | ✓ |');

    // Score matrix
    expect(md).toContain('## Score Matrix');
    expect(md).toContain('onboarding');
    expect(md).toContain('audit');

    // Per-goal scorecards
    expect(md).toContain('## Per-Goal Scorecards');
    expect(md).toContain('Brief: [onboarding](./onboarding/brief.md)');

    // Top risks
    expect(md).toContain('## Top Risks (Unified)');
    expect(md).toContain('**Risk one**');

    // Finding distribution
    expect(md).toContain('## Finding Distribution');
    expect(md).toContain('stack: 2');
    expect(md).toContain('security: 1');
    expect(md).toContain('high: 1');
    expect(md).toContain('medium: 1');
  });

  it('handles empty results and findings gracefully', () => {
    const md = renderMultiGoalSummary('empty-repo', [], [], makeMetrics({
      totalToolCalls: 0,
      totalDurationMs: 0,
      totalCostUsd: 0,
      passBreakdown: [],
    }));

    expect(md).toContain('# Universal Analysis: empty-repo');
    expect(md).toContain('**Findings:** 0 total');
    expect(md).toContain('## Score Matrix');
    // No risks section when no risks exist
    expect(md).not.toContain('## Top Risks');
    // Distribution still renders (with no entries)
    expect(md).toContain('## Finding Distribution');
  });

  it('appends error note when result has error field', () => {
    const results = [
      makeResult('nextjs', { error: 'API timeout' }),
    ];
    const md = renderMultiGoalSummary('test-repo', results, [], makeMetrics());

    expect(md).toContain('(partial: API timeout)');
  });

  it('deduplicates risks by id and sorts by severity, capping at 10', () => {
    const sharedRisk = makeRankedRisk({ rank: 1, findingId: 'SHARED-001', severity: 'critical', title: 'Shared critical', businessContext: 'Cross-cutting vulnerability' });
    const results = [
      makeResult('onboarding', {
        scorecard: makeScorecard({ topRisks: [sharedRisk, makeRankedRisk({ rank: 2, findingId: 'LOW-001', severity: 'low', title: 'Low risk', businessContext: 'Low risk desc' })] }),
      }),
      makeResult('audit', {
        scorecard: makeScorecard({ goalType: 'audit', topRisks: [sharedRisk, makeRankedRisk({ rank: 2, findingId: 'HIGH-001', severity: 'high', title: 'High risk', businessContext: 'High risk desc' })] }),
      }),
    ];

    const md = renderMultiGoalSummary('test-repo', results, [], makeMetrics());

    // SHARED-001 should appear only once
    const sharedMatches = md.match(/Shared critical/g);
    expect(sharedMatches).toHaveLength(1);

    // Critical should come before high which comes before low
    const criticalIdx = md.indexOf('Shared critical');
    const highIdx = md.indexOf('High risk');
    const lowIdx = md.indexOf('Low risk');
    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('truncates risk descriptions longer than 150 characters', () => {
    const longDesc = 'A'.repeat(200);
    const results = [
      makeResult('audit', {
        scorecard: makeScorecard({
          goalType: 'audit',
          topRisks: [makeRankedRisk({ rank: 1, findingId: 'LONG-001', severity: 'high', title: 'Long desc', businessContext: longDesc })],
        }),
      }),
    ];

    const md = renderMultiGoalSummary('test-repo', results, [], makeMetrics());

    expect(md).toContain('A'.repeat(150) + '...');
    expect(md).not.toContain('A'.repeat(151));
  });
});

describe('scoreEmoji', () => {
  it('returns correct emoji for each score level', () => {
    expect(scoreEmoji('red')).toBe('🔴');
    expect(scoreEmoji('yellow')).toBe('🟡');
    expect(scoreEmoji('green')).toBe('🟢');
  });

  it('returns white circle for unknown scores', () => {
    expect(scoreEmoji('invalid')).toBe('⚪');
    expect(scoreEmoji('')).toBe('⚪');
  });
});

describe('goalDisplayName', () => {
  it('maps all 8 goals to display names', () => {
    expect(goalDisplayName('onboarding')).toBe('Onboarding Brief');
    expect(goalDisplayName('audit')).toBe('Architecture Audit');
    expect(goalDisplayName('migration')).toBe('Migration Scout');
    expect(goalDisplayName('component-map')).toBe('Component Map');
    expect(goalDisplayName('ci-check')).toBe('CI Health Check');
    expect(goalDisplayName('security-review')).toBe('Security Review');
    expect(goalDisplayName('nextjs')).toBe('Next.js Audit');
    expect(goalDisplayName('accessibility')).toBe('Accessibility Audit');
  });

  it('returns goal unchanged for unknown goals', () => {
    expect(goalDisplayName('custom-goal')).toBe('custom-goal');
  });
});
