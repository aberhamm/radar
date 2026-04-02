import { NextResponse } from 'next/server';
import { getSession, resetSession } from '@/lib/agentSession';

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
    })),
    currentRun: session.currentRun ? {
      goal: session.currentRun.goal,
      repoName: session.currentRun.repoName,
      startedAt: session.currentRun.startedAt,
      eventCount: session.currentRun.events.length,
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
    try {
      const data = `data: ${JSON.stringify({ type: 'run_error', error: 'Run cancelled by user' })}\n\n`;
      session.currentRun.streamController.enqueue(new TextEncoder().encode(data));
      session.currentRun.streamController.close();
    } catch { /* stream already closed */ }
  }

  resetSession();
  return NextResponse.json({ ok: true });
}
