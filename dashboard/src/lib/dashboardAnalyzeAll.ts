/**
 * Dashboard orchestrator for multi-goal (--goal all) runs.
 *
 * Manages 3 sequential agent passes (core + nextjs + a11y), forwards SSE events,
 * persists 8 per-goal envelopes to tiered storage, and checks abort between passes.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import type { StepEvent, RunResult, RunMetrics } from './agentSession';
import { persistRun, type RunRecord } from './agentSession';
import { planBudget, rebalanceBudget, type BudgetPlan } from '@agent/agent/budgetPlanner';
import type { PreComputeResult } from '@agent/agent/runner';
import { ALL_GOALS } from '@agent/types/state';

export interface MultiGoalRunOptions {
  repoPath: string;
  repoName: string;
  repoSource: 'github' | 'local';
  repoUrl?: string;
  appRoot?: string;
  budget?: number;
  goals?: string[];
  outputDir?: string;
  preCompute?: PreComputeResult;
  onStep: (event: StepEvent) => void;
  onBudgetExhausted?: (state: { findings: number; toolCalls: number; budget: number }) => Promise<boolean>;
  abortSignal?: AbortSignal;
}

export interface MultiGoalRunResult {
  parentRunId: string;
  goals: Array<{
    goal: string;
    runId: string;
    scorecard?: unknown;
    metrics?: RunMetrics;
  }>;
  totalToolCalls: number;
  totalDurationMs: number;
}

/**
 * Run a multi-goal analysis from the dashboard.
 *
 * Executes 3 passes sequentially, scores all 8 goals, persists 8 envelopes,
 * and returns summary data for the dashboard UI.
 */
export async function dashboardAnalyzeAll(
  runAgent: (opts: Record<string, unknown>) => Promise<RunResult>,
  computeScorecard: (repoName: string, goal: string, findings: unknown[]) => unknown,
  opts: MultiGoalRunOptions,
): Promise<MultiGoalRunResult> {
  const parentRunId = crypto.randomUUID();
  const totalBudget = opts.budget ?? 100;
  const startTime = Date.now();
  const allEvents: StepEvent[] = [];
  let sharedState: Record<string, unknown> | undefined;
  let lastResult: RunResult | undefined;

  // Budget planning — deterministic allocation based on repo signals
  const plan: BudgetPlan = opts.preCompute
    ? planBudget(totalBudget, opts.preCompute)
    : planBudget(totalBudget, {});

  // Emit budget plan event
  const planEvent: StepEvent = {
    step: -1,
    action: 'budget_plan',
    result: JSON.stringify({ passes: plan.passes, signals: plan.signals }),
    timestamp: new Date().toISOString(),
  };
  allEvents.push(planEvent);
  opts.onStep(planEvent);

  let nextjsBudget = plan.passes[1].budget;
  let a11yBudget = plan.passes[2].budget;
  let skipNextjs = plan.passes[1].skip;
  let skipA11y = plan.passes[2].skip;

  // --- Pass 1: Core ---
  if (opts.abortSignal?.aborted) {
    throw new Error('Aborted before core pass');
  }

  try {
    const coreResult = await runAgent({
      repoPath: opts.repoPath,
      repoName: opts.repoName,
      repoSource: opts.repoSource,
      ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
      ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
      ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
      goal: plan.passes[0].goal,
      toolCallBudget: plan.passes[0].budget,
      verbose: true,
      preCompute: opts.preCompute,
      onStep: (event: StepEvent) => {
        allEvents.push(event);
        opts.onStep(event);
      },
      onBudgetExhausted: opts.onBudgetExhausted,
    });

    lastResult = coreResult;

    const passCompleteEvent: StepEvent = {
      step: -1,
      action: 'pass_complete',
      result: JSON.stringify({
        pass: 'Core',
        toolCalls: (coreResult.metrics as unknown as Record<string, unknown>)?.toolCalls ?? 0,
        budget: plan.passes[0].budget,
        terminationReason: (coreResult as unknown as Record<string, unknown>).terminationReason ?? 'completed',
      }),
      timestamp: new Date().toISOString(),
    };
    allEvents.push(passCompleteEvent);
    opts.onStep(passCompleteEvent);

    const fullState = coreResult.state as Record<string, unknown>;
    sharedState = {
      findings: fullState.findings,
      filesRead: fullState.filesRead,
      fileReadCache: fullState.fileReadCache,
      resolvedVersions: fullState.resolvedVersions,
      stackProfile: fullState.stackProfile,
      fetchedDocs: fullState.fetchedDocs,
      modelUsage: fullState.modelUsage,
    };

    // Post-core rebalance
    const rebalance = rebalanceBudget(plan, coreResult as any);
    nextjsBudget = rebalance.adjustedPasses[1].budget;
    a11yBudget = rebalance.adjustedPasses[2].budget;
    skipNextjs = rebalance.adjustedPasses[1].skip;
    skipA11y = rebalance.adjustedPasses[2].skip;

    const rebalanceEvent: StepEvent = {
      step: -1,
      action: 'budget_rebalance',
      result: JSON.stringify({
        adjustedPasses: rebalance.adjustedPasses.map(p => ({ name: p.name, budget: p.budget, skip: p.skip, reason: p.reason })),
        coreUtilization: rebalance.coreUtilization,
        adjustmentReasons: rebalance.adjustmentReasons,
      }),
      timestamp: new Date().toISOString(),
    };
    allEvents.push(rebalanceEvent);
    opts.onStep(rebalanceEvent);
  } catch (err) {
    console.warn(`[multi-goal] Core pass failed:`, (err as Error).message);
    throw err; // Core failure is fatal
  }

  // --- Pass 2: Next.js specialist ---
  if (!skipNextjs && nextjsBudget > 0 && !opts.abortSignal?.aborted) {
    const boundaryEvent: StepEvent = {
      step: -1,
      action: 'pass_boundary',
      result: 'Next.js Specialist',
      timestamp: new Date().toISOString(),
    };
    allEvents.push(boundaryEvent);
    opts.onStep(boundaryEvent);

    try {
      const result = await runAgent({
        repoPath: opts.repoPath,
        repoName: opts.repoName,
        repoSource: opts.repoSource,
        ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
        ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
        ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
        goal: 'nextjs',
        toolCallBudget: nextjsBudget,
        verbose: true,
        initialState: sharedState,
        onStep: (event: StepEvent) => {
          allEvents.push(event);
          opts.onStep(event);
        },
        onBudgetExhausted: opts.onBudgetExhausted,
      });

      lastResult = result;

      const passCompleteEvent: StepEvent = {
        step: -1,
        action: 'pass_complete',
        result: JSON.stringify({
          pass: 'Next.js Specialist',
          toolCalls: (result.metrics as unknown as Record<string, unknown>)?.toolCalls ?? 0,
          budget: nextjsBudget,
          terminationReason: (result as unknown as Record<string, unknown>).terminationReason ?? 'completed',
        }),
        timestamp: new Date().toISOString(),
      };
      allEvents.push(passCompleteEvent);
      opts.onStep(passCompleteEvent);

      const fullState = result.state as Record<string, unknown>;
      sharedState = {
        findings: fullState.findings,
        filesRead: fullState.filesRead,
        fileReadCache: fullState.fileReadCache,
        resolvedVersions: fullState.resolvedVersions,
        stackProfile: fullState.stackProfile,
        fetchedDocs: fullState.fetchedDocs,
        modelUsage: fullState.modelUsage,
      };
    } catch (err) {
      console.warn(`[multi-goal] Next.js Specialist pass failed:`, (err as Error).message);
    }
  } else if (!opts.abortSignal?.aborted) {
    const skipEvent: StepEvent = {
      step: -1,
      action: 'pass_boundary',
      result: 'Next.js Specialist (skipped)',
      timestamp: new Date().toISOString(),
    };
    allEvents.push(skipEvent);
    opts.onStep(skipEvent);
  }

  // --- Pass 3: Accessibility specialist ---
  if (!skipA11y && a11yBudget > 0 && !opts.abortSignal?.aborted) {
    const boundaryEvent: StepEvent = {
      step: -1,
      action: 'pass_boundary',
      result: 'Accessibility Specialist',
      timestamp: new Date().toISOString(),
    };
    allEvents.push(boundaryEvent);
    opts.onStep(boundaryEvent);

    try {
      const result = await runAgent({
        repoPath: opts.repoPath,
        repoName: opts.repoName,
        repoSource: opts.repoSource,
        ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
        ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
        ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
        goal: 'accessibility',
        toolCallBudget: a11yBudget,
        verbose: true,
        initialState: sharedState,
        onStep: (event: StepEvent) => {
          allEvents.push(event);
          opts.onStep(event);
        },
        onBudgetExhausted: opts.onBudgetExhausted,
      });

      lastResult = result;

      const passCompleteEvent: StepEvent = {
        step: -1,
        action: 'pass_complete',
        result: JSON.stringify({
          pass: 'Accessibility Specialist',
          toolCalls: (result.metrics as unknown as Record<string, unknown>)?.toolCalls ?? 0,
          budget: a11yBudget,
          terminationReason: (result as unknown as Record<string, unknown>).terminationReason ?? 'completed',
        }),
        timestamp: new Date().toISOString(),
      };
      allEvents.push(passCompleteEvent);
      opts.onStep(passCompleteEvent);

      const fullState = result.state as Record<string, unknown>;
      sharedState = {
        findings: fullState.findings,
        filesRead: fullState.filesRead,
        fileReadCache: fullState.fileReadCache,
        resolvedVersions: fullState.resolvedVersions,
        stackProfile: fullState.stackProfile,
        fetchedDocs: fullState.fetchedDocs,
        modelUsage: fullState.modelUsage,
      };
    } catch (err) {
      console.warn(`[multi-goal] Accessibility Specialist pass failed:`, (err as Error).message);
    }
  } else if (!opts.abortSignal?.aborted) {
    const skipEvent: StepEvent = {
      step: -1,
      action: 'pass_boundary',
      result: 'Accessibility Specialist (skipped)',
      timestamp: new Date().toISOString(),
    };
    allEvents.push(skipEvent);
    opts.onStep(skipEvent);
  }

  if (!lastResult) {
    throw new Error('No passes completed successfully');
  }

  const allFindings = (lastResult.state?.findings ?? []) as unknown[];
  const totalDurationMs = Date.now() - startTime;
  const totalToolCalls = allEvents.filter(e => e.type === 'tool_call').length;

  const selectedGoals = opts.goals ?? ALL_GOALS;
  const goals: MultiGoalRunResult['goals'] = [];

  for (const goal of selectedGoals) {
    const runId = crypto.randomUUID();
    const scorecard = computeScorecard(opts.repoName, goal, allFindings) as {
      overallScore: string;
      categories: unknown[];
      topRisks: unknown[];
    };

    // Persist each goal as a child entry
    const record: RunRecord = {
      id: runId,
      goal,
      repoName: opts.repoName,
      startedAt: new Date(lastResult.metrics.startedAt),
      completedAt: new Date(),
      overallScore: scorecard.overallScore as 'red' | 'yellow' | 'green',
      findingsCount: allFindings.length,
      result: {
        scorecard: scorecard as RunResult['scorecard'],
        metrics: lastResult.metrics,
        terminationReason: lastResult.terminationReason,
        briefMarkdown: '',
        outputPaths: [],
        state: { findings: allFindings },
        ...(lastResult.sources ? { sources: lastResult.sources } : {}),
      },
      events: [...allEvents],
      repoPath: opts.repoPath,
      repoSource: opts.repoSource,
      repoUrl: opts.repoUrl,
      parentRunId,
    };

    persistRun(record);

    goals.push({
      goal,
      runId,
      scorecard,
      metrics: lastResult.metrics,
    });
  }

  return {
    parentRunId,
    goals,
    totalToolCalls,
    totalDurationMs,
  };
}
