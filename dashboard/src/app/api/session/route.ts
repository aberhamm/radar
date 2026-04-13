import { NextRequest, NextResponse } from 'next/server';
import { getSession, resetSession, sendStreamEvent, loadPersistedRuns, getRunCount } from '@/lib/agentSession';

export async function GET(req: NextRequest) {
  const session = getSession();
  const url = new URL(req.url);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

  // If offset > 0, this is a "load more" request — read directly from disk
  const records = offset > 0
    ? loadPersistedRuns({ limit, offset })
    : session.history;

  const totalCount = getRunCount();

  return NextResponse.json({
    status: session.status,
    lastError: session.lastError ?? null,
    history: records.map(r => ({
      id: r.id,
      goal: r.goal,
      repoName: r.repoName,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      hasResult: !!r.result || !!r._dirPath,
      score: r.overallScore ?? r.result?.scorecard?.overallScore ?? null,
      findingsCount: r.findingsCount ?? 0,
      repoPath: r.repoPath,
      repoSource: r.repoSource,
      repoUrl: r.repoUrl,
      parentRunId: r.parentRunId,
    })),
    hasMore: offset + records.length < totalCount,
    currentRun: session.currentRun ? {
      id: session.currentRun.id,
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
