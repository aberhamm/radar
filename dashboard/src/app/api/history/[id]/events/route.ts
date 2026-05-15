import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEvents, findRunById } from '@/lib/agentSession';
import demoRun from '@/fixtures/demo-run.json';
import demoMultigoal from '@/fixtures/demo-run-multigoal.json';

const DEMO_EVENTS: Record<string, unknown[]> = {
  [demoRun.id]: demoRun.events,
  [demoMultigoal.id]: demoMultigoal.events,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const demoEvents = DEMO_EVENTS[id];
  if (demoEvents) {
    return NextResponse.json(
      { events: demoEvents },
      { headers: { 'Cache-Control': 'public, max-age=86400, immutable' } },
    );
  }

  const session = getSession();

  // Check current in-progress run first — not yet in history or on disk
  if (session.currentRun?.id === id) {
    return NextResponse.json(
      { events: session.currentRun.events },
      { headers: { 'Cache-Control': 'no-cache' } },
    );
  }

  let record = session.history.find(r => r.id === id);

  if (!record) {
    record = findRunById(id) ?? undefined;
  }

  if (!record) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const cacheHeaders: HeadersInit = record.completedAt
    ? { 'Cache-Control': 'public, max-age=86400, immutable' }
    : { 'Cache-Control': 'no-cache' };

  const events = loadRunEvents(record);
  return NextResponse.json({ events }, { headers: cacheHeaders });
}
