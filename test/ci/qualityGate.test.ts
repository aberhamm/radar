import { describe, it, expect } from 'vitest';
import { evaluateQualityGate, loadQualityGateConfig } from '../../src/ci/qualityGate.js';
import type { QualityGateConfig } from '../../src/ci/qualityGate.js';
import type { Scorecard } from '../../src/types/output.js';
import type { DiffResult } from '../../src/commands/diff.js';
import type { Finding } from '../../src/types/findings.js';

function makeScorecard(overallScore: 'red' | 'yellow' | 'green' = 'green'): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'ci-check',
    generatedAt: new Date().toISOString(),
    overallScore,
    categories: [],
    topRisks: [],
  };
}

function makeFinding(severity: string): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: severity as any,
    title: 'Test',
    description: 'Test finding',
    evidence: [],
    tags: [],
  };
}

function makeDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    newFindings: [],
    resolvedFindings: [],
    persistentFindings: [],
    summary: '',
    ...overrides,
  };
}

const defaultConfig: QualityGateConfig = {
  failOn: { overallScore: 'red', newCriticalFindings: true, newHighFindings: false },
  warnOn: { overallScore: 'yellow', newHighFindings: true, regressionCount: 3 },
};

describe('evaluateQualityGate', () => {
  it('passes when green and no new findings', () => {
    const result = evaluateQualityGate(makeScorecard('green'), null, defaultConfig);
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('pass');
    expect(result.reasons).toEqual([]);
  });

  it('fails when overall score is red', () => {
    const result = evaluateQualityGate(makeScorecard('red'), null, defaultConfig);
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('fail');
    expect(result.reasons[0]).toContain('red');
  });

  it('fails when new critical findings exist', () => {
    const diff = makeDiff({ newFindings: [makeFinding('critical')] });
    const result = evaluateQualityGate(makeScorecard('green'), diff, defaultConfig);
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('fail');
    expect(result.reasons[0]).toContain('critical');
  });

  it('warns when overall score is yellow', () => {
    const result = evaluateQualityGate(makeScorecard('yellow'), null, defaultConfig);
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toContain('yellow');
  });

  it('warns when new high findings exist', () => {
    const diff = makeDiff({ newFindings: [makeFinding('high')] });
    const result = evaluateQualityGate(makeScorecard('green'), diff, defaultConfig);
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('warn');
  });

  it('warns when regression count exceeds threshold', () => {
    const diff = makeDiff({
      newFindings: [makeFinding('medium'), makeFinding('medium'), makeFinding('low')],
    });
    const result = evaluateQualityGate(makeScorecard('green'), diff, defaultConfig);
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toContain('3 new findings');
  });

  it('does not fail on new high when newHighFindings is false', () => {
    const diff = makeDiff({ newFindings: [makeFinding('high')] });
    const result = evaluateQualityGate(makeScorecard('green'), diff, defaultConfig);
    // failOn.newHighFindings is false, so no fail — only warn
    expect(result.exitCode).toBe(0);
  });

  it('passes when diff is null (first run)', () => {
    const result = evaluateQualityGate(makeScorecard('green'), null, defaultConfig);
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('pass');
  });
});

describe('loadQualityGateConfig', () => {
  it('loads default config from config/quality-gates.json', () => {
    const config = loadQualityGateConfig();
    expect(config.failOn).toBeDefined();
    expect(config.warnOn).toBeDefined();
    expect(config.failOn.overallScore).toBe('red');
  });

  it('returns defaults for missing config file', () => {
    const config = loadQualityGateConfig('/nonexistent/path.json');
    expect(config.failOn.overallScore).toBe('red');
    expect(config.failOn.newCriticalFindings).toBe(true);
  });
});
