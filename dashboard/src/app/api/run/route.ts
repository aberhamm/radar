import { NextRequest, NextResponse } from 'next/server';
import { getSession, persistRun, checkpointRun, sendStreamEvent } from '@/lib/agentSession';
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

  // Register tsx ESM loader so dynamic import() can handle .ts files.
  // (.env is loaded eagerly at startup via src/instrumentation.ts)
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

  // Claim session immediately (before any await) to close the TOCTOU race window
  session.status = 'running';

  let body: { repoPath?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    session.status = 'idle';
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { repoPath, goal = 'onboarding' } = body;

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
      const result = await runAgent({
        repoPath: resolvedRepoPath,
        repoName,
        repoSource: 'local',
        goal: goal as 'onboarding' | 'audit' | 'migration' | 'component-map' | 'ci-check' | 'security-review',
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
          result,
          events: [...run.events],
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
