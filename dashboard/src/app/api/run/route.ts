import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/agentSession';
import { runAgent } from '@agent/agent/runner';
import path from 'node:path';

export async function POST(req: NextRequest) {
  const session = getSession();

  if (session.status === 'running' || session.status === 'budget_paused') {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }

  let body: { repoPath?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { repoPath, goal = 'onboarding' } = body;

  if (!repoPath) {
    return NextResponse.json({ error: 'repoPath is required' }, { status: 400 });
  }

  const repoName = path.basename(repoPath);
  const abortController = new AbortController();

  session.status = 'running';
  session.result = null;
  session.currentRun = {
    goal,
    repoPath,
    repoName,
    startedAt: new Date(),
    events: [],
    streamController: null,
    budgetResolve: null,
    abortController,
  };

  // Run agent asynchronously — don't await here
  (async () => {
    try {
      const result = await runAgent({
        repoPath,
        repoName,
        repoSource: 'local',
        goal: goal as import('@agent/types/state').GoalType,
        verbose: true,
        onStep: (event) => {
          const run = session.currentRun;
          if (!run) return;

          run.events.push(event);

          if (run.streamController) {
            try {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              run.streamController.enqueue(new TextEncoder().encode(data));
            } catch {
              // Stream closed — continue running
            }
          }
        },
        onBudgetExhausted: async (state) => {
          session.status = 'budget_paused';

          const run = session.currentRun;
          if (run?.streamController) {
            try {
              const data = `data: ${JSON.stringify({ type: 'budget_paused', findings: state.findings, toolCalls: state.toolCalls, budget: state.budget })}\n\n`;
              run.streamController.enqueue(new TextEncoder().encode(data));
            } catch { /* stream closed */ }
          }

          return new Promise<boolean>((resolve) => {
            if (session.currentRun) {
              session.currentRun.budgetResolve = resolve;
            }
          });
        },
      });

      const run = session.currentRun;
      if (run) {
        session.history.unshift({
          id: crypto.randomUUID(),
          goal: run.goal,
          repoName: run.repoName,
          startedAt: run.startedAt,
          completedAt: new Date(),
          result,
          events: [...run.events],
        });
        if (session.history.length > 5) session.history.pop();
      }

      session.status = 'complete';
      session.result = result;

      if (run?.streamController) {
        try {
          const data = `data: ${JSON.stringify({ type: 'run_complete', result: { scorecard: result.scorecard, metrics: result.metrics, terminationReason: result.terminationReason } })}\n\n`;
          run.streamController.enqueue(new TextEncoder().encode(data));
          run.streamController.close();
        } catch { /* stream already closed */ }
      }

    } catch (err) {
      session.status = 'error';
      const run = session.currentRun;
      if (run?.streamController) {
        try {
          const data = `data: ${JSON.stringify({ type: 'run_error', error: (err as Error).message })}\n\n`;
          run.streamController.enqueue(new TextEncoder().encode(data));
          run.streamController.close();
        } catch { /* stream closed */ }
      }
    }
  })();

  req.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  return NextResponse.json({ ok: true, repoName, goal });
}
