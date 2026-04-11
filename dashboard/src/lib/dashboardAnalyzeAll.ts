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

// Goal types for multi-goal scoring
const ALL_GOALS = [
  'onboarding', 'audit', 'migration', 'component-map',
  'ci-check', 'security-review', 'nextjs', 'accessibility',
] as const;

interface Pass {
  name: string;
  goal: string;
  budgetFraction: number;
}

const PASSES: Pass[] = [
  { name: 'Core', goal: 'universal', budgetFraction: 0.7 },
  { name: 'Next.js Specialist', goal: 'nextjs', budgetFraction: 0.15 },
  { name: 'Accessibility Specialist', goal: 'accessibility', budgetFraction: 0.15 },
];

export interface MultiGoalRunOptions {
  repoPath: string;
  repoName: string;
  repoSource: 'github' | 'local';
  repoUrl?: string;
  budget?: number;
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

  // Execute 3 passes sequentially
  for (let i = 0; i < PASSES.length; i++) {
    const pass = PASSES[i];

    // Abort check between passes
    if (opts.abortSignal?.aborted) {
      console.log(`[multi-goal] Aborted before ${pass.name} pass`);
      break;
    }

    // Inject pass boundary event (except before first pass)
    if (i > 0) {
      const boundaryEvent: StepEvent = {
        step: -1,
        action: 'pass_boundary',
        result: pass.name,
        timestamp: new Date().toISOString(),
      };
      allEvents.push(boundaryEvent);
      opts.onStep(boundaryEvent);
    }

    const passBudget = Math.floor(totalBudget * pass.budgetFraction);

    try {
      const result = await runAgent({
        repoPath: opts.repoPath,
        repoName: opts.repoName,
        repoSource: opts.repoSource,
        ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
        goal: pass.goal,
        toolCallBudget: passBudget,
        verbose: true,
        initialState: sharedState,
        onStep: (event: StepEvent) => {
          allEvents.push(event);
          opts.onStep(event);
        },
        onBudgetExhausted: opts.onBudgetExhausted,
      });

      lastResult = result;

      // Carry state forward to next pass.
      // The full agent state has many fields beyond what dashboard types expose.
      // We pass the raw state object through to runAgent's initialState param.
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
      console.warn(`[multi-goal] ${pass.name} pass failed:`, (err as Error).message);
      // Core failure is fatal; specialist failures are graceful degradation
      if (i === 0) throw err;
    }
  }

  if (!lastResult) {
    throw new Error('No passes completed successfully');
  }

  const allFindings = (lastResult.state?.findings ?? []) as unknown[];
  const totalDurationMs = Date.now() - startTime;
  const totalToolCalls = allEvents.filter(e => e.type === 'tool_call').length;

  // Score all 8 goals and persist each as a separate run
  const goals: MultiGoalRunResult['goals'] = [];

  for (const goal of ALL_GOALS) {
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
        briefMarkdown: '', // Brief writing happens separately or is deferred
        outputPaths: [],
        state: { findings: allFindings },
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
