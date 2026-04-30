import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunData, findRunById } from '@/lib/agentSession';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession();
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

  const data = loadRunData(record);
  if (!data) {
    return NextResponse.json({ error: 'No pre-computed data' }, { status: 404 });
  }

  return NextResponse.json(data, { headers: cacheHeaders });
}
