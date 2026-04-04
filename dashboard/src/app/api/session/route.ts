import { NextResponse } from 'next/server';
import { getSession, resetSession, sendStreamEvent } from '@/lib/agentSession';

export async function GET() {
  const session = getSession();
  return NextResponse.json({
    status: session.status,
    lastError: session.lastError ?? null,
    history: session.history.map(r => ({
      id: r.id,
      goal: r.goal,
      repoName: r.repoName,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      hasResult: !!r.result,
      score: r.result?.scorecard?.overallScore ?? null,
    })),
    currentRun: session.currentRun ? {
      goal: session.currentRun.goal,
      repoName: session.currentRun.repoName,
      startedAt: session.currentRun.startedAt,
      eventCount: session.currentRun.events.length,
      isAlive: !!session.currentRun.abortController && !session.currentRun.abortController.signal.aborted,
      budgetPausedData: session.currentRun.budgetPausedData ?? null,
    } : null,
    result: session.result ? {
      scorecard: session.result.scorecard,
      metrics: session.result.metrics,
      terminationReason: session.result.terminationReason,
      briefMarkdown: session.result.briefMarkdown,
    } : null,
  });
}

export async function DELETE() {
  const session = getSession();

  // Abort the running agent if there's one in progress
  if (session.currentRun?.abortController) {
    session.currentRun.abortController.abort();
  }

  // Close the SSE stream if open
  if (session.currentRun?.streamController) {
    sendStreamEvent(session.currentRun.streamController, { type: 'run_cancelled' });
    try { session.currentRun.streamController.close(); } catch { /* already closed */ }
  }

  resetSession();
  return NextResponse.json({ ok: true });
}
