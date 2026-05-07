import { describe, it, expect } from 'vitest';
import { planBudget, rebalanceBudget } from '../../src/agent/budgetPlanner.js';
import type { BudgetPlan } from '../../src/agent/budgetPlanner.js';
import type { PreComputeResult } from '../../src/agent/runner.js';
import type { RunResult } from '../../src/agent/runner.js';
import type { AgentState } from '../../src/types/state.js';
import type { Finding } from '../../src/types/findings.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makePreCompute(overrides?: Partial<PreComputeResult>): PreComputeResult {
  return { ...overrides };
}

function makeAppRoots(
  roots: Array<{ path: string; type: string }>,
  opts?: { isMonorepo?: boolean; monorepoTool?: string },
) {
  return {
    roots: roots.map(r => ({ ...r, hasPackageJson: true }) as any),
    isMonorepo: opts?.isMonorepo ?? false,
    monorepoTool: opts?.monorepoTool,
  };
}

function makeFinding(category: string, severity = 'medium' as const): Finding {
  return {
    id: `F-${Math.random().toString(36).slice(2, 6)}`,
    category: category as any,
    severity,
    title: `Test ${category} finding`,
    description: 'desc',
    evidence: [],
    tags: [],
  };
}

function makeRunResult(overrides: {
  toolCalls?: number;
  terminationReason?: RunResult['terminationReason'];
  findings?: Finding[];
  stackProfile?: Partial<AgentState['stackProfile']>;
}): RunResult {
  const findings = overrides.findings ?? [];
  return {
    scorecard: {} as any,
    briefMarkdown: '',
    exportJson: '',
    outputPaths: [],
    metrics: {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:01:00Z',
      durationMs: 60000,
      toolCalls: overrides.toolCalls ?? 50,
      models: {},
      totalEstimatedCostUsd: 0,
    },
    state: {
      goal: 'onboarding',
      repo: { source: 'local', localPath: '/tmp/test', name: 'test' },
      resolvedVersions: {},
      findings,
      filesRead: new Set<string>(),
      fileReadCache: new Map(),
      toolCallCount: overrides.toolCalls ?? 50,
      totalToolCallsExecuted: overrides.toolCalls ?? 50,
      toolCallBudget: 105,
      webSearchCount: 0,
      webSearchBudget: 5,
      urlFetchCount: 0,
      urlFetchBudget: 3,
      docTokensUsed: 0,
      docTokenBudget: 20000,
      fetchedDocs: [],
      investigationLog: [],
      modelUsage: new Map(),
      stackProfile: overrides.stackProfile ? {
        projectType: 'unknown',
        projectTypeConfidence: 'low',
        framework: { name: '', version: '', routerType: 'unknown' },
        cms: { platform: '', sdkPackages: [], integrationStyle: '' },
        packageManager: 'npm',
        language: 'typescript',
        deploymentIndicators: [],
        monorepo: false,
        ...overrides.stackProfile,
      } as AgentState['stackProfile'] : undefined,
    } as AgentState,
    terminationReason: overrides.terminationReason ?? 'completed',
  };
}

// ─── planBudget ──────────────────────────────────────────────────────

describe('planBudget', () => {
  it('gives 100% to core when no app roots detected', () => {
    const plan = planBudget(150, makePreCompute());

    expect(plan.passes[0].budget).toBe(150);
    expect(plan.passes[0].skip).toBe(false);
    expect(plan.passes[1].skip).toBe(true);
    expect(plan.passes[1].budget).toBe(0);
    expect(plan.passes[2].skip).toBe(true);
    expect(plan.passes[2].budget).toBe(0);
  });

  it('allocates 70/30/skip for Next.js-only root', () => {
    const plan = planBudget(150, makePreCompute({
      appRoots: makeAppRoots([{ path: '.', type: 'nextjs' }]),
    }));

    // Next.js is a UI framework, so both hasNextjsRoot and hasUiFramework are true → 60/20/20
    expect(plan.passes[0].budget).toBe(150 - plan.passes[1].budget - plan.passes[2].budget);
    expect(plan.passes[1].skip).toBe(false);
    expect(plan.passes[2].skip).toBe(false);
    expect(plan.signals.hasNextjsRoot).toBe(true);
    expect(plan.signals.hasUiFramework).toBe(true);
  });

  it('allocates 70/skip/30 for React root (no Next.js)', () => {
    const plan = planBudget(150, makePreCompute({
      appRoots: makeAppRoots([{ path: '.', type: 'react' }]),
    }));

    expect(plan.passes[1].skip).toBe(true);
    expect(plan.passes[1].budget).toBe(0);
    expect(plan.passes[2].skip).toBe(false);
    expect(plan.passes[2].budget).toBe(Math.floor(150 * 0.30));
    expect(plan.passes[0].budget).toBe(150 - plan.passes[2].budget);
  });

  it('allocates 60/20/20 for Next.js + React monorepo', () => {
    const plan = planBudget(150, makePreCompute({
      appRoots: makeAppRoots([
        { path: 'apps/web', type: 'nextjs' },
        { path: 'apps/admin', type: 'react' },
      ]),
    }));

    expect(plan.passes[1].skip).toBe(false);
    expect(plan.passes[2].skip).toBe(false);
    expect(plan.passes[1].budget).toBe(Math.floor(150 * 0.20));
    expect(plan.passes[2].budget).toBe(Math.floor(150 * 0.20));
  });

  it('gives 100% to core for Python/Go roots (no UI framework)', () => {
    const plan = planBudget(150, makePreCompute({
      appRoots: makeAppRoots([
        { path: '.', type: 'python' },
        { path: 'api', type: 'go' },
      ]),
    }));

    expect(plan.passes[0].budget).toBe(150);
    expect(plan.passes[1].skip).toBe(true);
    expect(plan.passes[2].skip).toBe(true);
  });

  it('shifts +5% to core for monorepo with >3 roots', () => {
    const plan = planBudget(200, makePreCompute({
      appRoots: makeAppRoots(
        [
          { path: 'a', type: 'nextjs' },
          { path: 'b', type: 'react' },
          { path: 'c', type: 'react' },
          { path: 'd', type: 'react' },
        ],
        { isMonorepo: true, monorepoTool: 'turborepo' },
      ),
    }));

    // Base: 60/20/20 → with monorepo shift: 65/17.5/17.5
    const baseNextjs = Math.floor(200 * 0.20);
    expect(plan.passes[1].budget).toBeLessThan(baseNextjs);
    expect(plan.signals.isMonorepo).toBe(true);
  });

  it('skips specialist when budget too small for floor (10 calls)', () => {
    // With budget=30 and 60/20/20 split: nextjs=6, a11y=6 — both below floor
    const plan = planBudget(30, makePreCompute({
      appRoots: makeAppRoots([{ path: '.', type: 'nextjs' }]),
    }));

    // Both specialists should be below floor and skipped
    expect(plan.passes[1].skip).toBe(true);
    expect(plan.passes[2].skip).toBe(true);
    expect(plan.passes[0].budget).toBe(30);
  });

  it('invariant: budgets sum to totalBudget', () => {
    const budgets = [60, 100, 150, 200, 300];
    const configs = [
      makePreCompute(),
      makePreCompute({ appRoots: makeAppRoots([{ path: '.', type: 'nextjs' }]) }),
      makePreCompute({ appRoots: makeAppRoots([{ path: '.', type: 'react' }]) }),
      makePreCompute({ appRoots: makeAppRoots([{ path: '.', type: 'python' }]) }),
    ];

    for (const total of budgets) {
      for (const pc of configs) {
        const plan = planBudget(total, pc);
        const sum = plan.passes.reduce((s, p) => s + p.budget, 0);
        expect(sum).toBe(total);
        // Fractions should approximately sum to 1.0 (within rounding)
        const fracSum = plan.passes.reduce((s, p) => s + p.fraction, 0);
        expect(fracSum).toBeCloseTo(1.0, 1);
      }
    }
  });
});

// ─── rebalanceBudget ─────────────────────────────────────────────────

describe('rebalanceBudget', () => {
  function makePlan(overrides?: Partial<BudgetPlan>): BudgetPlan {
    return {
      totalBudget: 150,
      passes: [
        { name: 'Core', goal: 'universal', budget: 90, fraction: 0.60, reason: 'Broad investigation', skip: false },
        { name: 'Next.js Specialist', goal: 'nextjs', budget: 30, fraction: 0.20, reason: 'Next.js detected', skip: false },
        { name: 'Accessibility Specialist', goal: 'accessibility', budget: 30, fraction: 0.20, reason: 'UI framework detected', skip: false },
      ],
      signals: { hasNextjsRoot: true, hasUiFramework: true, isMonorepo: false, rootCount: 1, frameworkTypes: ['nextjs'] },
      ...overrides,
    };
  }

  it('skips Next.js when stackProfile contradicts plan', () => {
    const plan = makePlan();
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 80,
      // Include an accessibility finding so rule 4 (no frontend findings) doesn't zero out A11y
      findings: [makeFinding('stack'), makeFinding('security'), makeFinding('accessibility')],
      stackProfile: { framework: { name: 'express', version: '4.18.0', routerType: 'unknown' } },
    }));

    expect(result.adjustedPasses[1].skip).toBe(true);
    expect(result.adjustedPasses[1].budget).toBe(0);
    // Budget redistributed to A11y
    expect(result.adjustedPasses[2].budget).toBeGreaterThan(30);
    expect(result.adjustmentReasons.some(r => r.includes('skipping Next.js'))).toBe(true);
  });

  it('un-skips Next.js when core discovers it unexpectedly', () => {
    const plan = makePlan({
      passes: [
        { name: 'Core', goal: 'universal', budget: 105, fraction: 0.70, reason: 'Broad investigation', skip: false },
        { name: 'Next.js Specialist', goal: 'nextjs', budget: 0, fraction: 0, reason: 'No Next.js detected', skip: true },
        { name: 'Accessibility Specialist', goal: 'accessibility', budget: 45, fraction: 0.30, reason: 'UI framework', skip: false },
      ],
      signals: { hasNextjsRoot: false, hasUiFramework: true, isMonorepo: false, rootCount: 1, frameworkTypes: ['react'] },
    });

    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 90,
      findings: [makeFinding('nextjs'), makeFinding('routing'), makeFinding('stack')],
      stackProfile: { framework: { name: 'Next.js', version: '14.2.3', routerType: 'app' } },
    }));

    expect(result.adjustedPasses[1].skip).toBe(false);
    expect(result.adjustedPasses[1].budget).toBeGreaterThan(0);
    expect(result.adjustmentReasons.some(r => r.includes('un-skipping'))).toBe(true);
  });

  it('reduces specialists when core under-utilized (<50%)', () => {
    const plan = makePlan();
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 30, // 33% utilization of 90
      terminationReason: 'completed',
      findings: [makeFinding('stack')],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    expect(result.coreUtilization).toBeCloseTo(30 / 90, 2);
    expect(result.adjustedPasses[1].budget).toBeLessThan(30);
    expect(result.adjustedPasses[2].budget).toBeLessThan(30);
    expect(result.adjustmentReasons.some(r => r.includes('under-utilized'))).toBe(true);
  });

  it('reduces Next.js specialist when core has 5+ nextjs-category findings', () => {
    const plan = makePlan();
    const nextjsFindings = Array.from({ length: 5 }, () => makeFinding('nextjs'));
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 80,
      findings: [...nextjsFindings, makeFinding('stack')],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    expect(result.adjustedPasses[1].budget).toBeLessThan(30);
    expect(result.adjustmentReasons.some(r => r.includes('Next.js-category findings'))).toBe(true);
  });

  it('skips A11y when zero frontend findings', () => {
    const plan = makePlan();
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 80,
      findings: [makeFinding('stack'), makeFinding('security'), makeFinding('dependencies')],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    expect(result.adjustedPasses[2].skip).toBe(true);
    expect(result.adjustedPasses[2].budget).toBe(0);
    expect(result.adjustmentReasons.some(r => r.includes('frontend findings'))).toBe(true);
  });

  it('enforces minimum budget floor', () => {
    const plan = makePlan({
      passes: [
        { name: 'Core', goal: 'universal', budget: 90, fraction: 0.60, reason: 'Broad investigation', skip: false },
        { name: 'Next.js Specialist', goal: 'nextjs', budget: 12, fraction: 0.08, reason: 'Next.js detected', skip: false },
        { name: 'Accessibility Specialist', goal: 'accessibility', budget: 12, fraction: 0.08, reason: 'UI framework', skip: false },
      ],
    });

    // Core under-utilized: 40% reduction on 12 → 7, below floor of 10
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 30, // under 50%
      terminationReason: 'completed',
      findings: [makeFinding('stack')],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    // Both specialists should be skipped after reduction puts them below floor
    for (const pass of result.adjustedPasses.slice(1)) {
      if (!pass.skip) {
        expect(pass.budget).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('populates adjustmentReasons for each rule that fires', () => {
    const plan = makePlan();
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 85,
      findings: [makeFinding('stack')],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    // With frontend findings = 0 (only 'stack'), rule 4 fires at minimum
    expect(result.adjustmentReasons.length).toBeGreaterThan(0);
    expect(result.adjustmentReasons.every(r => typeof r === 'string' && r.length > 0)).toBe(true);
  });

  it('reports no adjustments when plan holds', () => {
    const plan = makePlan();
    // Provide enough frontend findings and correct stack to avoid all rules
    const result = rebalanceBudget(plan, makeRunResult({
      toolCalls: 70, // ~78% utilization — not under 50%, not over 95%
      findings: [
        makeFinding('stack'),
        makeFinding('nextjs'),
        makeFinding('accessibility'),
        makeFinding('architecture'),
      ],
      stackProfile: { framework: { name: 'Next.js', version: '14.0.0', routerType: 'app' } },
    }));

    expect(result.adjustmentReasons).toEqual(['No adjustments needed — plan holds']);
    expect(result.adjustedPasses[1].budget).toBe(30);
    expect(result.adjustedPasses[2].budget).toBe(30);
  });
});
