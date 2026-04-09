import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEvents } from '@/lib/agentSession';

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

  return NextResponse.json({
    id: record.id,
    goal: record.goal,
    repoName: record.repoName,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    events: loadRunEvents(record),
    result: record.result ? {
      scorecard: record.result.scorecard,
      metrics: record.result.metrics,
      terminationReason: record.result.terminationReason,
      briefMarkdown: record.result.briefMarkdown,
      state: { findings: record.result.state?.findings ?? [] },
    } : null,
  });
}
