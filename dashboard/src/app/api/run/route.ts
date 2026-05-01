import { NextRequest, NextResponse } from 'next/server';
import { getSession, persistRun, checkpointRun, sendStreamEvent, loadPersistedRuns } from '@/lib/agentSession';
import type { StepEvent, RunResult } from '@/lib/agentSession';
import { dashboardAnalyzeAll } from '@/lib/dashboardAnalyzeAll';
import { ALL_GOALS } from '@/lib/goals';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENT_OUTPUT_DIR = path.resolve(process.cwd(), '..', 'output');
const BUDGET_PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

async function loadRunner() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const distPath = path.resolve(process.cwd(), '..', 'dist', 'agent', 'runner.js');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
  return {
    runAgent: mod.runAgent as typeof import('@agent/agent/runner').runAgent,
    runPreCompute: mod.runPreCompute as typeof import('@agent/agent/runner').runPreCompute,
  };
}

async function loadScorecard() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const distPath = path.resolve(process.cwd(), '..', 'dist', 'output', 'scorecard.js');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
  return mod.computeScorecard as (repoName: string, goal: string, findings: unknown[]) => unknown;
}

function createBudgetPauseHandler() {
  return async (state: { findings: number; toolCalls: number; budget: number }): Promise<boolean> => {
    const session = getSession();
    session.status = 'budget_paused';
    const pauseData = { findings: state.findings, toolCalls: state.toolCalls, budget: state.budget };

    if (session.currentRun) {
      session.currentRun.budgetPausedData = pauseData;
    }

    sendStreamEvent(session.currentRun?.streamController ?? null, {
      type: 'budget_paused', ...pauseData,
    });

    // Heartbeat keeps the SSE connection alive while the user decides
    const heartbeat = setInterval(() => {
      sendStreamEvent(session.currentRun?.streamController ?? null, {
        type: 'heartbeat', timestamp: new Date().toISOString(),
      });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const decision = await new Promise<boolean>((resolve) => {
        if (session.currentRun) {
          session.currentRun.budgetResolve = resolve;
        }

        // Auto-resolve as "finish" after timeout so the agent never hangs forever
        setTimeout(() => resolve(false), BUDGET_PAUSE_TIMEOUT_MS);
      });

      // Emit resume event immediately so the UI shows feedback before the next LLM call
      session.status = 'running';
      sendStreamEvent(session.currentRun?.streamController ?? null, {
        type: 'budget_resumed', extended: decision, timestamp: new Date().toISOString(),
      });

      return decision;
    } finally {
      clearInterval(heartbeat);
      if (session.currentRun) {
        session.currentRun.budgetPausedData = null;
        session.currentRun.budgetResolve = null;
      }
    }
  };
}

export async function POST(req: NextRequest) {
  const session = getSession();

  if (session.status === 'running' || session.status === 'budget_paused') {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }

  // Claim session immediately (before any await) to close the TOCTOU race window
  session.status = 'running';

  let body: { repoPath?: string; goal?: string; goals?: string[]; repoSource?: string; repoUrl?: string; appRoot?: string; budget?: number; parallel?: boolean };
  try {
    body = await req.json();
  } catch {
    session.status = 'idle';
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { repoPath, goal = 'onboarding', goals: goalsArray, repoSource, repoUrl, appRoot, parallel } = body;
  const requestedBudget = body.budget;

  if (!repoPath) {
    session.status = 'idle';
    return NextResponse.json({ error: 'repoPath is required' }, { status: 400 });
  }

  // Resolve relative paths against the repo root (one level up from dashboard/)
  const resolvedRepoPath = path.isAbsolute(repoPath)
    ? repoPath
    : path.resolve(process.cwd(), '..', repoPath);

  // Pre-flight: verify repo exists and has files
  const fs = await import(/* webpackIgnore: true */ 'node:fs');
  if (!fs.existsSync(resolvedRepoPath)) {
    session.status = 'idle';
    return NextResponse.json({ error: `Repository not found: ${resolvedRepoPath}` }, { status: 400 });
  }
  const entries = fs.readdirSync(resolvedRepoPath).filter((f: string) => f !== '.git');
  if (entries.length === 0) {
    session.status = 'idle';
    return NextResponse.json({ error: `Repository is empty: ${resolvedRepoPath}` }, { status: 400 });
  }

  const repoName = repoUrl
    ? repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    : path.basename(resolvedRepoPath);
  const runId = crypto.randomUUID();
  const abortController = new AbortController();
  session.result = null;
  session.currentRun = {
    id: runId,
    goal,
    repoPath: resolvedRepoPath,
    repoName,
    startedAt: new Date(),
    events: [],
    streamController: null,
    budgetResolve: null,
    budgetPausedData: null,
    abortController,
  };

  // Run agent asynchronously — don't await here
  (async () => {
    try {
      // Startup progress: push to run.events (for persistence + SSE replay) and stream
      const emitStatus = (message: string) => {
        const event: StepEvent = {
          type: 'status', step: 0, action: 'startup', result: message, timestamp: new Date().toISOString(),
        };
        const run = session.currentRun;
        if (run) run.events.push(event);
        sendStreamEvent(run?.streamController ?? null, event);
      };

      emitStatus('Loading agent runner...');
      const { runAgent, runPreCompute } = await loadRunner();
      emitStatus('Agent loaded');

      const isMultiGoal = goal === 'all' || (goalsArray && goalsArray.length > 1);
      if (isMultiGoal) {
        const selectedGoals = goalsArray ?? [...ALL_GOALS];
        emitStatus('Loading scorecard engine...');
        const computeScorecard = await loadScorecard();

        emitStatus('Pre-computing repo signals...');
        const preCompute = await runPreCompute(resolvedRepoPath, appRoot);

        emitStatus(parallel
          ? `Starting parallel analysis (${selectedGoals.length} goals)...`
          : `Starting universal analysis (3 passes, ${selectedGoals.length} goals)...`);

        const multiResult = await dashboardAnalyzeAll(
          runAgent as unknown as (opts: Record<string, unknown>) => Promise<RunResult>,
          computeScorecard,
          {
            repoPath: resolvedRepoPath,
            repoName,
            repoSource: (repoSource as 'github' | 'local') ?? 'local',
            repoUrl: repoUrl,
            ...(appRoot ? { appRoot } : {}),
            budget: requestedBudget ?? 30,
            goals: selectedGoals,
            outputDir: AGENT_OUTPUT_DIR,
            preCompute: preCompute as Record<string, unknown>,
            parallel: parallel ?? false,
            onStep: (event: StepEvent) => {
              const run = session.currentRun;
              if (!run) return;
              run.events.push(event);
              sendStreamEvent(run.streamController, event);
              if (run.events.length % 10 === 0) {
                checkpointRun(run);
              }
            },
            onBudgetExhausted: createBudgetPauseHandler(),
            abortSignal: abortController.signal,
          },
        );

        // Use the first goal's result for the session completion
        const firstGoal = multiResult.goals[0];
        session.status = 'complete';
        session.result = {
          scorecard: firstGoal?.scorecard as any,
          metrics: firstGoal?.metrics as any,
          terminationReason: 'completed',
          briefMarkdown: '',
          outputPaths: [],
          state: { findings: [] },
        };

        // Refresh history
        session.history = loadPersistedRuns({ limit: 50 });

        const run = session.currentRun;
        sendStreamEvent(run?.streamController ?? null, {
          type: 'run_complete',
          multiGoal: true,
          parentRunId: multiResult.parentRunId,
          goals: multiResult.goals.map(g => ({ goal: g.goal, runId: g.runId })),
          result: { scorecard: firstGoal?.scorecard, metrics: firstGoal?.metrics, terminationReason: 'completed' },
        });
        try { run?.streamController?.close(); } catch { /* already closed */ }
        return;
      }

      // Single-goal: existing flow
      emitStatus(`Starting ${goal} analysis...`);
      const result = await runAgent({
        repoPath: resolvedRepoPath,
        repoName,
        repoSource: (repoSource as 'github' | 'local') ?? 'local',
        ...(repoUrl ? { repoUrl } : {}),
        ...(appRoot ? { appRoot } : {}),
        goal: goal as 'onboarding' | 'audit' | 'audit-generic' | 'migration' | 'component-map' | 'ci-check' | 'security-review' | 'nextjs' | 'accessibility' | 'performance',
        ...(requestedBudget ? { toolCallBudget: requestedBudget } : {}),
        outputDir: AGENT_OUTPUT_DIR,
        verbose: true,
        onStep: (event) => {
          const run = session.currentRun;
          if (!run) return;

          run.events.push(event);
          sendStreamEvent(run.streamController, event);

          // Checkpoint every 10 events so data survives crashes
          if (run.events.length % 10 === 0) {
            checkpointRun(run);
          }
        },
        onBudgetExhausted: createBudgetPauseHandler(),
      });

      const run = session.currentRun;
      if (run) {
        const record = {
          id: run.id,
          goal: run.goal,
          repoName: run.repoName,
          startedAt: run.startedAt,
          completedAt: new Date(),
          overallScore: result.scorecard?.overallScore,
          findingsCount: result.state?.findings?.length ?? 0,
          result,
          events: [...run.events],
          repoPath: run.repoPath,
          repoSource: (repoSource as 'github' | 'local') ?? 'local',
          repoUrl: repoUrl,
        };
        session.history.unshift(record);
        if (session.history.length > 10) session.history.pop();
        persistRun(record);
      }

      session.status = 'complete';
      session.result = result;

      sendStreamEvent(run?.streamController ?? null, {
        type: 'run_complete', result: { scorecard: result.scorecard, metrics: result.metrics, terminationReason: result.terminationReason },
      });
      try { run?.streamController?.close(); } catch { /* already closed */ }

    } catch (err) {
      console.error('[run] Agent error:', (err as Error).message, (err as Error).stack);
      session.status = 'error';
      session.lastError = (err as Error).message;
      const run = session.currentRun;
      sendStreamEvent(run?.streamController ?? null, { type: 'run_error', error: (err as Error).message });
      try { run?.streamController?.close(); } catch { /* already closed */ }
    }
  })();

  req.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  const isMultiGoalResponse = goal === 'all' || (goalsArray && goalsArray.length > 1);
  const effectiveBudget = requestedBudget ?? (isMultiGoalResponse ? 30 : 45);
  const effectiveGoalCount = isMultiGoalResponse ? (goalsArray?.length ?? ALL_GOALS.length) : 1;
  return NextResponse.json({ ok: true, repoName, goal, runId, budget: effectiveBudget, goalCount: effectiveGoalCount });
}
