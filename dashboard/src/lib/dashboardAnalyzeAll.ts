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
import { ALL_GOALS } from './goals';

/** Opaque pass-through — dashboard never inspects this, just forwards to runAgent. */
type PreComputeResult = Record<string, unknown>;

async function loadAgentModule(moduleName: string) {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');

  const distPath = path.resolve(process.cwd(), '..', 'dist', 'agent', `${moduleName}.js`);
  if (fs.existsSync(distPath)) {
    return import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
  }

  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }
  const srcPath = path.resolve(process.cwd(), '..', 'src', 'agent', `${moduleName}.ts`);
  return import(/* webpackIgnore: true */ pathToFileURL(srcPath).href);
}

async function loadBudgetPlanner() {
  const mod = await loadAgentModule('budgetPlanner');
  return {
    planBudget: mod.planBudget as (totalBudget: number, preCompute: PreComputeResult) => { passes: Array<{ goal: string; budget: number; skip: boolean; name: string; reason?: string }>; signals: Record<string, unknown> },
    rebalanceBudget: mod.rebalanceBudget as (plan: unknown, coreResult: unknown) => { adjustedPasses: Array<{ budget: number; skip: boolean; name: string; reason?: string }>; coreUtilization: number; adjustmentReasons: string[] },
    planClusterBudget: mod.planClusterBudget as (totalBudget: number, preCompute: PreComputeResult) => { totalBudget: number; clusters: Array<{ clusterId: string; name: string; categories: string[]; budget: number; fraction: number; skip: boolean; skipReason?: string; color: string }>; signals: Record<string, unknown>; synthesisBudget: number },
  };
}

async function loadSynthesisRunner() {
  const mod = await loadAgentModule('synthesisRunner');
  return mod.runSynthesis as (config: Record<string, unknown>) => Promise<{ crossCuttingFindings: Array<{ id: string }> }>;
}

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
  parallel?: boolean;
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
  findings: unknown[];
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
  let stepOffset = 0;

  // Budget planning — deterministic allocation based on repo signals
  const { planBudget, rebalanceBudget } = await loadBudgetPlanner();
  const plan = opts.preCompute
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

  // ─── Parallel dispatch ─────────────────────────────────────────────
  if (opts.parallel && opts.preCompute) {
    return dashboardParallelDispatch(runAgent, computeScorecard, opts, allEvents);
  }

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
    stepOffset = ((coreResult.metrics as unknown as Record<string, unknown>)?.toolCalls as number) ?? 0;

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
        preCompute: opts.preCompute,
        mode: 'worker',
        onStep: (event: StepEvent) => {
          const adjusted = event.step > 0 ? { ...event, step: event.step + stepOffset } : event;
          const tagged = { ...adjusted, specialistId: 'nextjs-specialist' };
          allEvents.push(tagged);
          opts.onStep(tagged);
        },
        onBudgetExhausted: opts.onBudgetExhausted,
      });

      lastResult = result;
      stepOffset += ((result.metrics as unknown as Record<string, unknown>)?.toolCalls as number) ?? 0;

      const passCompleteEvent: StepEvent = {
        step: -1,
        action: 'pass_complete',
        specialistId: 'nextjs-specialist',
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
        preCompute: opts.preCompute,
        mode: 'worker',
        onStep: (event: StepEvent) => {
          const adjusted = event.step > 0 ? { ...event, step: event.step + stepOffset } : event;
          const tagged = { ...adjusted, specialistId: 'a11y-specialist' };
          allEvents.push(tagged);
          opts.onStep(tagged);
        },
        onBudgetExhausted: opts.onBudgetExhausted,
      });

      lastResult = result;
      stepOffset += ((result.metrics as unknown as Record<string, unknown>)?.toolCalls as number) ?? 0;

      const passCompleteEvent: StepEvent = {
        step: -1,
        action: 'pass_complete',
        specialistId: 'a11y-specialist',
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
    findings: allFindings,
  };
}

// ─── Parallel dispatch (dashboard) ──────────────────────────────────

async function dashboardParallelDispatch(
  runAgent: (opts: Record<string, unknown>) => Promise<RunResult>,
  computeScorecard: (repoName: string, goal: string, findings: unknown[]) => unknown,
  opts: MultiGoalRunOptions,
  allEvents: StepEvent[],
): Promise<MultiGoalRunResult> {
  const parentRunId = crypto.randomUUID();
  const totalBudget = opts.budget ?? 100;
  const startTime = Date.now();

  const { planClusterBudget } = await loadBudgetPlanner();
  const clusterPlan = planClusterBudget(totalBudget, opts.preCompute!);
  const activeClusters = clusterPlan.clusters.filter(c => !c.skip);

  const clusterEvent: StepEvent = {
    step: -1,
    action: 'cluster_plan',
    result: JSON.stringify({ clusters: clusterPlan.clusters, signals: clusterPlan.signals, synthesisBudget: clusterPlan.synthesisBudget }),
    timestamp: new Date().toISOString(),
  };
  allEvents.push(clusterEvent);
  opts.onStep(clusterEvent);

  // Dispatch workers in parallel
  const workerResults = await Promise.allSettled(
    activeClusters.map(async (cluster) => {
      if (opts.abortSignal?.aborted) throw new Error('Aborted');
      let result: RunResult;
      try {
        result = await runAgent({
          repoPath: opts.repoPath,
          repoName: opts.repoName,
          repoSource: opts.repoSource,
          ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
          ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
          ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
          goal: 'audit-generic',
          toolCallBudget: cluster.budget,
          verbose: true,
          preCompute: opts.preCompute,
          mode: 'worker',
          workerId: cluster.clusterId,
          allowedCategories: cluster.categories,
          onStep: (event: StepEvent) => {
            allEvents.push(event);
            opts.onStep(event);
          },
        });
      } catch (workerErr) {
        const msg = workerErr instanceof Error ? workerErr.stack ?? workerErr.message : String(workerErr);
        console.error(`[parallel] Worker ${cluster.clusterId} (${cluster.name}) failed:`, msg);
        throw workerErr;
      }
      const completeEvent: StepEvent = {
        step: -1,
        action: 'worker_complete',
        workerId: cluster.clusterId,
        result: JSON.stringify({
          worker: cluster.name,
          toolCalls: (result.metrics as unknown as Record<string, unknown>)?.toolCalls ?? 0,
          findings: ((result.state as Record<string, unknown>)?.findings as unknown[] ?? []).length,
        }),
        timestamp: new Date().toISOString(),
      };
      allEvents.push(completeEvent);
      opts.onStep(completeEvent);
      return { cluster, result };
    }),
  );

  // Merge findings from all successful workers
  const seenIds = new Set<string>();
  const mergedFindings: unknown[] = [];
  let lastResult: RunResult | undefined;

  const workerErrors: string[] = [];
  for (const settled of workerResults) {
    if (settled.status === 'rejected') {
      const reason = settled.reason;
      const detail = reason instanceof Error
        ? (reason.stack ?? reason.message)
        : (typeof reason === 'string' ? reason : JSON.stringify(reason));
      console.error(`[parallel] Worker rejected:`, detail);
      workerErrors.push(detail);
      continue;
    }
    const { result } = settled.value;
    lastResult = result;
    const findings = (result.state as Record<string, unknown>)?.findings as Array<{ id: string }> ?? [];
    for (const f of findings) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        mergedFindings.push(f);
      }
    }
  }

  if (!lastResult) {
    const details = workerErrors.length > 0
      ? `Worker errors: ${workerErrors.join('; ')}`
      : 'All workers rejected with no error details';
    throw new Error(`No workers completed successfully. ${details}`);
  }

  // Synthesis pass
  if (clusterPlan.synthesisBudget > 0 && mergedFindings.length > 0) {
    try {
      const synthStart: StepEvent = {
        step: -1, action: 'synthesis_start', workerId: 'synthesis',
        result: `Synthesizing ${mergedFindings.length} findings...`,
        timestamp: new Date().toISOString(),
      };
      allEvents.push(synthStart);
      opts.onStep(synthStart);

      const runSynthesis = await loadSynthesisRunner();
      const synthResult = await runSynthesis({
        repoPath: opts.repoPath,
        repoName: opts.repoName,
        goal: 'audit-generic' as any,
        findings: mergedFindings as any,
        toolCallBudget: clusterPlan.synthesisBudget,
        outputDir: opts.outputDir,
        onStep: (event: StepEvent) => {
          allEvents.push(event);
          opts.onStep(event);
        },
      });

      if (synthResult.crossCuttingFindings.length > 0) {
        for (const f of synthResult.crossCuttingFindings) {
          if (!seenIds.has(f.id)) {
            seenIds.add(f.id);
            mergedFindings.push(f);
          }
        }
      }

      const synthComplete: StepEvent = {
        step: -1, action: 'synthesis_complete', workerId: 'synthesis',
        result: JSON.stringify({ crossCutting: synthResult.crossCuttingFindings.length }),
        timestamp: new Date().toISOString(),
      };
      allEvents.push(synthComplete);
      opts.onStep(synthComplete);
    } catch {
      // Synthesis is best-effort
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const totalToolCalls = allEvents.filter(e => e.type === 'tool_call').length;
  const selectedGoals = opts.goals ?? ALL_GOALS;
  const goals: MultiGoalRunResult['goals'] = [];

  for (const goal of selectedGoals) {
    const runId = crypto.randomUUID();
    const scorecard = computeScorecard(opts.repoName, goal, mergedFindings) as {
      overallScore: string;
      categories: unknown[];
      topRisks: unknown[];
    };

    const record: RunRecord = {
      id: runId,
      goal,
      repoName: opts.repoName,
      startedAt: new Date(lastResult.metrics.startedAt),
      completedAt: new Date(),
      overallScore: scorecard.overallScore as 'red' | 'yellow' | 'green',
      findingsCount: mergedFindings.length,
      result: {
        scorecard: scorecard as RunResult['scorecard'],
        metrics: lastResult.metrics,
        terminationReason: lastResult.terminationReason,
        briefMarkdown: '',
        outputPaths: [],
        state: { findings: mergedFindings },
        ...(lastResult.sources ? { sources: lastResult.sources } : {}),
      },
      events: [...allEvents],
      repoPath: opts.repoPath,
      repoSource: opts.repoSource,
      repoUrl: opts.repoUrl,
      parentRunId,
    };
    persistRun(record);

    goals.push({ goal, runId, scorecard, metrics: lastResult.metrics });
  }

  return { parentRunId, goals, totalToolCalls, totalDurationMs, findings: mergedFindings };
}
