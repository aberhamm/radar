import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunFindings, findRunById } from '@/lib/agentSession';

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

  // In-memory result has findings directly
  if (record.result?.state?.findings) {
    return NextResponse.json({ findings: record.result.state.findings }, { headers: cacheHeaders });
  }

  // Otherwise load from disk
  const findings = loadRunFindings(record);
  return NextResponse.json({ findings }, { headers: cacheHeaders });
}
