import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunSources, findRunById } from '@/lib/agentSession';

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
    ? { 'Cache-Control': 'public, max-age=300, immutable' }
    : { 'Cache-Control': 'no-cache' };

  if (record.result?.sources) {
    return NextResponse.json({ sources: record.result.sources }, { headers: cacheHeaders });
  }

  const sources = loadRunSources(record);
  return NextResponse.json({ sources }, { headers: cacheHeaders });
}
