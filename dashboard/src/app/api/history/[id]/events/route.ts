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

  const events = loadRunEvents(record);
  return NextResponse.json({ events });
}
