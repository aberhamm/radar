import { describe, it, expect } from 'vitest';
import { renderCiComment } from '../../src/output/ciComment.js';
import type { Scorecard, RunMetrics, CategoryScore, RankedRisk, FindingCount, ScorecardMetadata } from '../../src/types/output.js';
import type { Finding } from '../../src/types/findings.js';

const ZERO_COUNTS: FindingCount = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

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

function makeRankedRisk(overrides: Partial<RankedRisk> = {}): RankedRisk {
  return {
    rank: 1,
    findingId: 'TEST-001',
    title: 'Test risk',
    severity: 'medium',
    businessContext: 'Test business context',
    recommendation: 'Fix it',
    ...overrides,
  };
}

function makeMetrics(overrides?: Partial<RunMetrics>): RunMetrics {
  return {
    startedAt: '2026-04-04T00:00:00Z',
    completedAt: '2026-04-04T00:00:45Z',
    durationMs: 45000,
    toolCalls: 12,
    models: {},
    totalEstimatedCostUsd: 0.38,
    ...overrides,
  };
}

function makeMetadata(overrides?: Partial<ScorecardMetadata>): ScorecardMetadata {
  return {
    repoName: 'test-repo',
    analysisDate: new Date().toISOString(),
    agentVersion: '1.0.0',
    goalType: 'ci-check',
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
    category: 'security',
    score: 'green',
    findings: [],
    findingCount: { ...ZERO_COUNTS },
    keyFindings: [],
    summary: 'OK',
    ...overrides,
  };
}

function makeScorecard(overrides?: Partial<Scorecard>): Scorecard {
  return {
    metadata: makeMetadata(),
    repoName: 'test-repo',
    goalType: 'ci-check',
    generatedAt: '2026-04-04T00:00:45Z',
    overallScore: 'green',
    categories: [
      makeCategory({ category: 'dependencies' }),
      makeCategory({ category: 'security' }),
      makeCategory({ category: 'configuration' }),
    ],
    topRisks: [],
    findings: [],
    ...overrides,
  };
}

describe('renderCiComment', () => {
  it('renders FAIL with blocking issues for red scorecard', () => {
    const criticalFinding = makeFinding({
      id: 'SEC-001',
      severity: 'critical',
      title: 'Hardcoded API key',
      evidence: [{ filePath: 'src/config.ts', lineNumber: 42, snippet: 'key = "sk-..."', description: 'Exposed secret' }],
    });
    const highFinding = makeFinding({
      id: 'DEP-001',
      severity: 'high',
      title: 'React 17 → 19 gap',
      evidence: [{ filePath: 'package.json', lineNumber: 10, snippet: '"react": "^17.0.2"', description: '2 major versions behind' }],
    });

    const scorecard = makeScorecard({
      overallScore: 'red',
      categories: [
        makeCategory({ category: 'dependencies', score: 'red', findings: [highFinding], summary: 'Critical gaps' }),
        makeCategory({ category: 'security', score: 'red', findings: [criticalFinding], summary: 'Exposed secrets' }),
        makeCategory({ category: 'configuration' }),
      ],
      topRisks: [
        makeRankedRisk({ rank: 1, findingId: 'SEC-001', title: 'Hardcoded API key', severity: 'critical', businessContext: 'Exposed secret in config' }),
        makeRankedRisk({ rank: 2, findingId: 'DEP-001', title: 'React 17 → 19 gap', severity: 'high', businessContext: '2 major versions behind' }),
      ],
      findings: [criticalFinding, highFinding],
    });

    const output = renderCiComment(scorecard, makeMetrics());

    expect(output).toContain('Radar CI Check: FAIL');
    expect(output).toContain('🔴');
    expect(output).toContain('### Blocking Issues');
    expect(output).toContain('[CRITICAL] Hardcoded API key');
    expect(output).toContain('`src/config.ts:42`');
    expect(output).toContain('[HIGH] React 17 → 19 gap');
    expect(output).toContain('`package.json:10`');
  });

  it('renders PASS with no blocking section for green scorecard', () => {
    const scorecard = makeScorecard({
      overallScore: 'green',
      categories: [
        makeCategory({ category: 'dependencies' }),
        makeCategory({ category: 'security' }),
        makeCategory({ category: 'configuration' }),
      ],
      topRisks: [],
    });

    const output = renderCiComment(scorecard, makeMetrics());

    expect(output).toContain('Radar CI Check: PASS');
    expect(output).toContain('🟢');
    expect(output).not.toContain('### Blocking Issues');
  });

  it('keeps output under 50 lines', () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding({
        id: `F-${i}`,
        severity: 'high',
        title: `Issue ${i}`,
        evidence: [{ filePath: `src/file${i}.ts`, lineNumber: i + 1, snippet: 'x', description: 'desc' }],
      }),
    );

    const scorecard = makeScorecard({
      overallScore: 'red',
      categories: [
        makeCategory({ category: 'dependencies', score: 'red', findings: findings.slice(0, 3), summary: 'Bad' }),
        makeCategory({ category: 'security', score: 'yellow', findings: findings.slice(3, 4), summary: 'Warn' }),
        makeCategory({ category: 'configuration', score: 'yellow', findings: findings.slice(4), summary: 'Warn' }),
      ],
      topRisks: findings.map((f, i) => makeRankedRisk({ rank: i + 1, findingId: f.id, title: f.title, severity: f.severity })),
      findings,
    });

    const output = renderCiComment(scorecard, makeMetrics());
    const lineCount = output.split('\n').length;

    expect(lineCount).toBeLessThan(50);
  });

  it('shows correct emoji for each score level', () => {
    const scorecard = makeScorecard({
      overallScore: 'yellow',
      categories: [
        makeCategory({ category: 'dependencies', score: 'red', findings: [makeFinding({})], summary: 'Bad' }),
        makeCategory({ category: 'security', score: 'yellow', summary: 'Warn' }),
        makeCategory({ category: 'configuration' }),
      ],
      topRisks: [],
    });

    const output = renderCiComment(scorecard, makeMetrics());

    expect(output).toContain('🔴 red');
    expect(output).toContain('🟡 yellow');
    expect(output).toContain('🟢 green');
  });

  it('excludes low-confidence findings from blocking issues', () => {
    const lowConfFinding = makeFinding({
      id: 'SEC-LOW',
      severity: 'critical',
      title: 'Speculative secret leak',
      confidence: 5,
      evidence: [{ filePath: 'src/config.ts', lineNumber: 1, snippet: 'x', description: 'desc' }],
    });
    const highConfFinding = makeFinding({
      id: 'SEC-HIGH',
      severity: 'high',
      title: 'Confirmed secret leak',
      confidence: 9,
      evidence: [{ filePath: 'src/env.ts', lineNumber: 2, snippet: 'y', description: 'desc' }],
    });

    const scorecard = makeScorecard({
      overallScore: 'red',
      // Low-confidence findings are excluded from topRisks by the agent
      topRisks: [
        makeRankedRisk({ rank: 1, findingId: 'SEC-HIGH', title: 'Confirmed secret leak', severity: 'high' }),
      ],
      findings: [lowConfFinding, highConfFinding],
    });

    const output = renderCiComment(scorecard, makeMetrics());
    // Low confidence critical should NOT appear as blocking
    expect(output).not.toContain('Speculative secret leak');
    // High confidence high should appear
    expect(output).toContain('Confirmed secret leak');
  });

  it('includes footer with metrics', () => {
    const output = renderCiComment(makeScorecard(), makeMetrics({ toolCalls: 12, durationMs: 45000, totalEstimatedCostUsd: 0.38 }));

    expect(output).toContain('12 tool calls');
    expect(output).toContain('$0.38');
    expect(output).toContain('45s');
  });
});
