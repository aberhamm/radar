/**
 * Deterministic budget planning and post-core rebalancing for multi-goal runs.
 *
 * Two entry points:
 *   planBudget()      — pre-pass allocation based on PreComputeResult signals
 *   rebalanceBudget() — post-core adjustment based on core pass results
 *
 * No LLM, no I/O. Pure functions with typed inputs and outputs.
 */

import type { PreComputeResult } from './preCompute.js';
import type { RunResult } from './runnerTypes.js';
import type { FindingCategory } from '../types/findings.js';
import { MIN_SPECIALIST_BUDGET } from '../config/defaults.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface PassAllocation {
  name: string;
  goal: string;
  budget: number;
  fraction: number;
  reason: string;
  skip: boolean;
}

export interface BudgetSignals {
  hasNextjsRoot: boolean;
  hasUiFramework: boolean;
  isMonorepo: boolean;
  rootCount: number;
  frameworkTypes: string[];
}

export interface BudgetPlan {
  totalBudget: number;
  passes: [PassAllocation, PassAllocation, PassAllocation];
  signals: BudgetSignals;
}

export interface RebalanceResult {
  adjustedPasses: [PassAllocation, PassAllocation, PassAllocation];
  coreUtilization: number;
  coreTerminationReason: string;
  adjustmentReasons: string[];
}

// ─── Constants ───────────────────────────────────────────────────────

const UI_FRAMEWORK_TYPES = new Set([
  'nextjs', 'react', 'remix', 'svelte', 'nuxt', 'astro', 'angular', 'vue',
]);

const NEXTJS_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  'nextjs', 'routing', 'data-fetching',
]);

const A11Y_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  'accessibility', 'aria', 'forms',
  'media-alt', 'semantic-html', 'keyboard-focus', 'color-contrast',
]);

const FRONTEND_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  ...NEXTJS_CATEGORIES, ...A11Y_CATEGORIES, 'architecture', 'performance',
]);

// ─── planBudget ──────────────────────────────────────────────────────

export function planBudget(totalBudget: number, preCompute: PreComputeResult): BudgetPlan {
  const roots = preCompute.appRoots?.roots?.filter(r => !r.path.startsWith('...')) ?? [];
  const frameworkTypes = [...new Set(roots.map(r => r.type))];

  const signals: BudgetSignals = {
    hasNextjsRoot: roots.some(r => r.type === 'nextjs'),
    hasUiFramework: roots.some(r => UI_FRAMEWORK_TYPES.has(r.type)),
    isMonorepo: preCompute.appRoots?.isMonorepo ?? false,
    rootCount: roots.length,
    frameworkTypes,
  };

  // Base allocation from signal matrix
  let coreFrac: number;
  let nextjsFrac: number;
  let a11yFrac: number;
  let skipNextjs: boolean;
  let skipA11y: boolean;

  if (signals.hasNextjsRoot && signals.hasUiFramework) {
    // Next.js is itself a UI framework, so both are always true together,
    // but there may also be non-Next.js UI roots (e.g. a Vue app in a monorepo)
    coreFrac = 0.60;
    nextjsFrac = 0.20;
    a11yFrac = 0.20;
    skipNextjs = false;
    skipA11y = false;
  } else if (signals.hasNextjsRoot) {
    // Next.js without other UI framework — shouldn't happen (Next.js is UI), but handle it
    coreFrac = 0.70;
    nextjsFrac = 0.30;
    a11yFrac = 0;
    skipNextjs = false;
    skipA11y = true;
  } else if (signals.hasUiFramework) {
    coreFrac = 0.70;
    nextjsFrac = 0;
    a11yFrac = 0.30;
    skipNextjs = true;
    skipA11y = false;
  } else {
    coreFrac = 1.0;
    nextjsFrac = 0;
    a11yFrac = 0;
    skipNextjs = true;
    skipA11y = true;
  }

  // Monorepo adjustment: wide surface area needs more core budget
  if (signals.isMonorepo && signals.rootCount > 3) {
    const shift = 0.05;
    if (!skipNextjs && !skipA11y) {
      nextjsFrac -= shift / 2;
      a11yFrac -= shift / 2;
    } else if (!skipNextjs) {
      nextjsFrac -= shift;
    } else if (!skipA11y) {
      a11yFrac -= shift;
    }
    coreFrac += shift;
  }

  // Convert fractions to absolute budgets
  let coreBudget = Math.floor(totalBudget * coreFrac);
  let nextjsBudget = skipNextjs ? 0 : Math.floor(totalBudget * nextjsFrac);
  let a11yBudget = skipA11y ? 0 : Math.floor(totalBudget * a11yFrac);

  // Floor enforcement: specialists below minimum get skipped, budget goes to core
  if (!skipNextjs && nextjsBudget < MIN_SPECIALIST_BUDGET) {
    skipNextjs = true;
    nextjsBudget = 0;
  }
  if (!skipA11y && a11yBudget < MIN_SPECIALIST_BUDGET) {
    skipA11y = true;
    a11yBudget = 0;
  }

  // Give remainder to core (rounding + any reclaimed budget)
  coreBudget = totalBudget - nextjsBudget - a11yBudget;

  // Recompute fractions from final absolute values
  const cFrac = coreBudget / totalBudget;
  const nFrac = nextjsBudget / totalBudget;
  const aFrac = a11yBudget / totalBudget;

  return {
    totalBudget,
    passes: [
      {
        name: 'Core',
        goal: 'universal',
        budget: coreBudget,
        fraction: cFrac,
        reason: buildCoreReason(signals),
        skip: false, // core never skips
      },
      {
        name: 'Next.js Specialist',
        goal: 'nextjs',
        budget: nextjsBudget,
        fraction: nFrac,
        reason: skipNextjs ? 'No Next.js app root detected' : `Next.js detected in ${roots.filter(r => r.type === 'nextjs').length} root(s)`,
        skip: skipNextjs,
      },
      {
        name: 'Accessibility Specialist',
        goal: 'accessibility',
        budget: a11yBudget,
        fraction: aFrac,
        reason: skipA11y ? 'No UI framework detected' : `UI framework detected (${frameworkTypes.filter(t => UI_FRAMEWORK_TYPES.has(t)).join(', ')})`,
        skip: skipA11y,
      },
    ],
    signals,
  };
}

function buildCoreReason(signals: BudgetSignals): string {
  const parts: string[] = [];
  if (signals.isMonorepo) parts.push(`monorepo (${signals.rootCount} roots)`);
  if (signals.frameworkTypes.length > 0) parts.push(signals.frameworkTypes.join(', '));
  if (parts.length === 0) return 'Broad investigation';
  return `Broad investigation: ${parts.join('; ')}`;
}

// ─── rebalanceBudget ─────────────────────────────────────────────────

export function rebalanceBudget(plan: BudgetPlan, coreResult: RunResult): RebalanceResult {
  const [core, nextjs, a11y] = plan.passes;
  const adjustmentReasons: string[] = [];

  const coreUtilization = core.budget > 0 ? coreResult.metrics.toolCalls / core.budget : 0;
  const coreTerminationReason = coreResult.terminationReason;

  // Start from planned values
  let nextjsBudget = nextjs.budget;
  let a11yBudget = a11y.budget;
  let skipNextjs = nextjs.skip;
  let skipA11y = a11y.skip;
  let nextjsReason = nextjs.reason;
  let a11yReason = a11y.reason;

  // Count findings by category
  const categoryCounts = new Map<FindingCategory, number>();
  for (const f of coreResult.state.findings) {
    categoryCounts.set(f.category, (categoryCounts.get(f.category) ?? 0) + 1);
  }

  const nextjsFindingCount = sumCategories(categoryCounts, NEXTJS_CATEGORIES);
  const a11yFindingCount = sumCategories(categoryCounts, A11Y_CATEGORIES);
  const frontendFindingCount = sumCategories(categoryCounts, FRONTEND_CATEGORIES);

  // Rule 1: stackProfile contradicts plan
  const detectedFramework = coreResult.state.stackProfile?.framework.name?.toLowerCase() ?? '';
  const coreFoundNextjs = detectedFramework.includes('next');

  if (!skipNextjs && !coreFoundNextjs && nextjsFindingCount === 0) {
    // Plan allocated Next.js but core found no evidence of Next.js
    adjustmentReasons.push(`stackProfile shows "${detectedFramework || 'unknown'}", no Next.js findings — skipping Next.js specialist`);
    skipNextjs = true;
    const reclaimed = nextjsBudget;
    nextjsBudget = 0;
    nextjsReason = `Skipped: core found no Next.js (framework: ${detectedFramework || 'unknown'})`;
    // Redistribute to A11y if it's running, otherwise unused
    if (!skipA11y) {
      a11yBudget += reclaimed;
      adjustmentReasons.push(`Redistributed ${reclaimed} calls from Next.js to Accessibility`);
    }
  } else if (skipNextjs && coreFoundNextjs && nextjsFindingCount > 0) {
    // Plan skipped Next.js but core discovered it
    const unskipBudget = Math.floor(plan.totalBudget * 0.15);
    if (unskipBudget >= MIN_SPECIALIST_BUDGET) {
      skipNextjs = false;
      nextjsBudget = unskipBudget;
      nextjsReason = `Un-skipped: core discovered Next.js (${nextjsFindingCount} findings)`;
      // Take from A11y if it's running
      if (!skipA11y) {
        a11yBudget = Math.max(MIN_SPECIALIST_BUDGET, a11yBudget - Math.floor(unskipBudget / 2));
      }
      adjustmentReasons.push(`Core discovered Next.js — un-skipping specialist with ${unskipBudget} calls`);
    }
  }

  // Rule 2: Core under-utilized — repo simpler than expected
  if (coreUtilization < 0.5 && coreTerminationReason === 'completed') {
    const reduction = 0.4;
    if (!skipNextjs) {
      const reduced = Math.floor(nextjsBudget * reduction);
      nextjsBudget -= reduced;
      adjustmentReasons.push(`Core under-utilized (${pct(coreUtilization)}) — reducing Next.js by ${reduced} calls`);
    }
    if (!skipA11y) {
      const reduced = Math.floor(a11yBudget * reduction);
      a11yBudget -= reduced;
      adjustmentReasons.push(`Core under-utilized (${pct(coreUtilization)}) — reducing Accessibility by ${reduced} calls`);
    }
  }

  // Rule 3: Heavy specialist-category findings in core
  if (!skipNextjs && nextjsFindingCount >= 5) {
    const reduced = Math.floor(nextjsBudget * 0.4);
    nextjsBudget -= reduced;
    nextjsReason = `Reduced: core already found ${nextjsFindingCount} Next.js-category findings`;
    adjustmentReasons.push(`Core found ${nextjsFindingCount} Next.js-category findings — reducing specialist by ${reduced} calls`);
  }
  if (!skipA11y && a11yFindingCount >= 5) {
    const reduced = Math.floor(a11yBudget * 0.4);
    a11yBudget -= reduced;
    a11yReason = `Reduced: core already found ${a11yFindingCount} a11y-category findings`;
    adjustmentReasons.push(`Core found ${a11yFindingCount} a11y-category findings — reducing specialist by ${reduced} calls`);
  }

  // Rule 4: No frontend findings at all — skip A11y
  if (!skipA11y && frontendFindingCount === 0 && coreResult.state.findings.length > 0) {
    adjustmentReasons.push('Zero frontend findings in core — skipping Accessibility specialist');
    skipA11y = true;
    a11yBudget = 0;
    a11yReason = 'Skipped: no frontend findings in core pass';
  }

  // Floor enforcement
  if (!skipNextjs && nextjsBudget < MIN_SPECIALIST_BUDGET) {
    adjustmentReasons.push(`Next.js budget (${nextjsBudget}) below floor (${MIN_SPECIALIST_BUDGET}) — skipping`);
    skipNextjs = true;
    nextjsBudget = 0;
    nextjsReason = 'Skipped: budget reduced below minimum';
  }
  if (!skipA11y && a11yBudget < MIN_SPECIALIST_BUDGET) {
    adjustmentReasons.push(`Accessibility budget (${a11yBudget}) below floor (${MIN_SPECIALIST_BUDGET}) — skipping`);
    skipA11y = true;
    a11yBudget = 0;
    a11yReason = 'Skipped: budget reduced below minimum';
  }

  if (adjustmentReasons.length === 0) {
    adjustmentReasons.push('No adjustments needed — plan holds');
  }

  const total = plan.totalBudget;
  return {
    adjustedPasses: [
      { ...core, reason: core.reason }, // core budget is already spent, unchanged
      {
        name: 'Next.js Specialist',
        goal: 'nextjs',
        budget: nextjsBudget,
        fraction: nextjsBudget / total,
        reason: nextjsReason,
        skip: skipNextjs,
      },
      {
        name: 'Accessibility Specialist',
        goal: 'accessibility',
        budget: a11yBudget,
        fraction: a11yBudget / total,
        reason: a11yReason,
        skip: skipA11y,
      },
    ],
    coreUtilization,
    coreTerminationReason,
    adjustmentReasons,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sumCategories(counts: Map<FindingCategory, number>, categories: ReadonlySet<FindingCategory>): number {
  let total = 0;
  for (const cat of categories) {
    total += counts.get(cat) ?? 0;
  }
  return total;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
