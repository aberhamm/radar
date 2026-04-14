import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunFindings } from '@/lib/agentSession';

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

  // In-memory result has findings directly
  if (record.result?.state?.findings) {
    return NextResponse.json({ findings: record.result.state.findings });
  }

  // Otherwise load from disk
  const findings = loadRunFindings(record);
  return NextResponse.json({ findings });
}
