import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEnvelope, loadRunFindings, findRunById } from '@/lib/agentSession';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slim = req.nextUrl.searchParams.get('slim') === '1';
  const session = getSession();
  let record = session.history.find(r => r.id === id);

  // Fallback: look up from disk index (survives HMR / session loss)
  if (!record) {
    record = findRunById(id) ?? undefined;
  }

  if (!record) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const cacheHeaders: HeadersInit = record.completedAt
    ? { 'Cache-Control': 'public, max-age=86400, immutable' }
    : { 'Cache-Control': 'no-cache' };

  // Current/just-completed run: result is still in memory
  if (record.result) {
    return NextResponse.json({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      repoUrl: record.repoUrl,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: {
        scorecard: record.result.scorecard,
        metrics: record.result.metrics,
        terminationReason: record.result.terminationReason,
        briefMarkdown: record.result.briefMarkdown,
        state: { findings: slim ? [] : (record.result.state?.findings ?? []) },
      },
    }, { headers: cacheHeaders });
  }

  // Historical run: load from tiered storage (Tier 2 + 3)
  const envelope = loadRunEnvelope(record);
  if (!envelope) {
    // Record exists but envelope not on disk yet (in-progress or HMR wiped memory).
    // Return metadata so the UI can render; findings/events load via their own routes.
    return NextResponse.json({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      repoUrl: record.repoUrl,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: {
        scorecard: null,
        metrics: null,
        terminationReason: null,
        briefMarkdown: null,
        state: { findings: slim ? [] : loadRunFindings(record) },
      },
    }, { headers: cacheHeaders });
  }

  // Skip expensive findings load in slim mode (findings only needed for PDF export)
  const findings = slim ? [] : loadRunFindings(record);

  return NextResponse.json({
    id: record.id,
    goal: record.goal,
    repoName: record.repoName,
    repoUrl: record.repoUrl,
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt,
    result: {
      scorecard: envelope.scorecard,
      metrics: envelope.metrics,
      terminationReason: envelope.terminationReason,
      briefMarkdown: envelope.briefMarkdown,
      state: { findings },
    },
  }, { headers: cacheHeaders });
}
