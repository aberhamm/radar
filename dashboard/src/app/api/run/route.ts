import { NextRequest, NextResponse } from 'next/server';
import { getSession, persistRun, checkpointRun, sendStreamEvent, loadPersistedRuns } from '@/lib/agentSession';
import type { StepEvent, RunResult } from '@/lib/agentSession';
import { dashboardAnalyzeAll } from '@/lib/dashboardAnalyzeAll';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Load the agent runner at runtime, completely bypassing webpack.
 *
 * Prefers compiled JS from dist/ (fast — no compilation overhead).
 * Falls back to tsx loader for raw .ts source if dist/ doesn't exist.
 */
async function loadRunner() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');

  // Prefer compiled JS — avoids tsx cold-start penalty (~5-10s on Windows)
  const distPath = path.resolve(process.cwd(), '..', 'dist', 'agent', 'runner.js');
  if (fs.existsSync(distPath)) {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
    return mod.runAgent as typeof import('@agent/agent/runner').runAgent;
  }

  // Fallback: tsx loader for development without a build step
  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered or unavailable */ }

  const agentPath = path.resolve(process.cwd(), '..', 'src', 'agent', 'runner.ts');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(agentPath).href);
  return mod.runAgent as typeof import('@agent/agent/runner').runAgent;
}

/**
 * Load computeScorecard at runtime, same pattern as loadRunner.
 */
async function loadScorecard() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');

  const distPath = path.resolve(process.cwd(), '..', 'dist', 'output', 'scorecard.js');
  if (fs.existsSync(distPath)) {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
    return mod.computeScorecard as (repoName: string, goal: string, findings: unknown[]) => unknown;
  }

  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }

  const srcPath = path.resolve(process.cwd(), '..', 'src', 'output', 'scorecard.ts');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(srcPath).href);
  return mod.computeScorecard as (repoName: string, goal: string, findings: unknown[]) => unknown;
}

export async function POST(req: NextRequest) {
  const session = getSession();

  if (session.status === 'running' || session.status === 'budget_paused') {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }

  // Claim session immediately (before any await) to close the TOCTOU race window
  session.status = 'running';

  let body: { repoPath?: string; goal?: string; repoSource?: string; repoUrl?: string };
  try {
    body = await req.json();
  } catch {
    session.status = 'idle';
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { repoPath, goal = 'onboarding', repoSource, repoUrl } = body;

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

  const repoName = path.basename(resolvedRepoPath);
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
      const runAgent = await loadRunner();

      // Multi-goal: use orchestrator for goal='all'
      if (goal === 'all') {
        const computeScorecard = await loadScorecard();

        const multiResult = await dashboardAnalyzeAll(
          runAgent as unknown as (opts: Record<string, unknown>) => Promise<RunResult>,
          computeScorecard,
          {
            repoPath: resolvedRepoPath,
            repoName,
            repoSource: (repoSource as 'github' | 'local') ?? 'local',
            repoUrl: repoUrl,
            budget: 100,
            onStep: (event: StepEvent) => {
              const run = session.currentRun;
              if (!run) return;
              if (event.type === 'text_delta' || event.type === 'tool_start') {
                sendStreamEvent(run.streamController, event);
                return;
              }
              run.events.push(event);
              sendStreamEvent(run.streamController, event);
              if (run.events.length % 10 === 0) {
                checkpointRun(run);
              }
            },
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
      const result = await runAgent({
        repoPath: resolvedRepoPath,
        repoName,
        repoSource: (repoSource as 'github' | 'local') ?? 'local',
        ...(repoUrl ? { repoUrl } : {}),
        goal: goal as 'onboarding' | 'audit' | 'migration' | 'component-map' | 'ci-check' | 'security-review' | 'nextjs' | 'accessibility',
        verbose: true,
        onStep: (event) => {
          const run = session.currentRun;
          if (!run) return;

          // Stream transient events to client but don't persist
          // text_delta: high-frequency, replaced by text_response on message_end
          // tool_start: replaced by tool_call after execution completes
          if (event.type === 'text_delta' || event.type === 'tool_start') {
            sendStreamEvent(run.streamController, event);
            return;
          }

          run.events.push(event);
          sendStreamEvent(run.streamController, event);

          // Checkpoint every 10 events so data survives crashes
          if (run.events.length % 10 === 0) {
            checkpointRun(run);
          }
        },
        onBudgetExhausted: async (state) => {
          session.status = 'budget_paused';
          const pauseData = { findings: state.findings, toolCalls: state.toolCalls, budget: state.budget };

          if (session.currentRun) {
            session.currentRun.budgetPausedData = pauseData;
          }

          sendStreamEvent(session.currentRun?.streamController ?? null, {
            type: 'budget_paused', ...pauseData,
          });

          return new Promise<boolean>((resolve) => {
            if (session.currentRun) {
              session.currentRun.budgetResolve = resolve;
            }
          });
        },
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

  return NextResponse.json({ ok: true, repoName, goal });
}
