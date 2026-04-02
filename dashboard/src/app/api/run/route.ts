import { NextRequest, NextResponse } from 'next/server';
import { getSession, persistRun } from '@/lib/agentSession';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Load the agent runner at runtime via tsx, completely bypassing webpack.
 * The agent source tree is heavy (Pi Agent, tools, Node.js APIs) and webpack
 * takes 5+ minutes to compile it. tsx handles TypeScript natively.
 */
async function loadRunner() {
  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');

  // Load .env from the repo root (dotenv is only auto-loaded in src/index.ts CLI entry)
  const dotenv = await import(/* webpackIgnore: true */ 'dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

  // Register tsx ESM loader so dynamic import() can handle .ts files.
  // Safe to call multiple times — Node ignores duplicate registrations.
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered or unavailable */ }

  const agentPath = path.resolve(process.cwd(), '..', 'src', 'agent', 'runner.ts');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(agentPath).href);
  return mod.runAgent as typeof import('@agent/agent/runner').runAgent;
}

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
      const runAgent = await loadRunner();
      const result = await runAgent({
        repoPath,
        repoName,
        repoSource: 'local',
        goal: goal as 'onboarding' | 'audit' | 'migration' | 'component-map' | 'ci-check' | 'security-review',
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
        const record = {
          id: crypto.randomUUID(),
          goal: run.goal,
          repoName: run.repoName,
          startedAt: run.startedAt,
          completedAt: new Date(),
          result,
          events: [...run.events],
        };
        session.history.unshift(record);
        if (session.history.length > 10) session.history.pop();
        persistRun(record);
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
      console.error('[run] Agent error:', (err as Error).message, (err as Error).stack);
      session.status = 'error';
      session.lastError = (err as Error).message;
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
