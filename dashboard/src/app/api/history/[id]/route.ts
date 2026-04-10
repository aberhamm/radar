import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEvents, loadRunEnvelope, loadRunFindings } from '@/lib/agentSession';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession();
  const record = session.history.find(r => r.id === id);

  if (!record) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Current/just-completed run: result is still in memory
  if (record.result) {
    return NextResponse.json({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      events: loadRunEvents(record),
      result: {
        scorecard: record.result.scorecard,
        metrics: record.result.metrics,
        terminationReason: record.result.terminationReason,
        briefMarkdown: record.result.briefMarkdown,
        state: { findings: record.result.state?.findings ?? [] },
      },
    });
  }

  // Historical run: load from tiered storage (Tier 2 + 3)
  const envelope = loadRunEnvelope(record);
  if (!envelope) {
    return NextResponse.json({ error: 'Run data not found on disk' }, { status: 404 });
  }

  const findings = loadRunFindings(record);

  return NextResponse.json({
    id: record.id,
    goal: record.goal,
    repoName: record.repoName,
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt,
    events: loadRunEvents(record),
    result: {
      scorecard: envelope.scorecard,
      metrics: envelope.metrics,
      terminationReason: envelope.terminationReason,
      briefMarkdown: envelope.briefMarkdown,
      state: { findings },
    },
  });
}
