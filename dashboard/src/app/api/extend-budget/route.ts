import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/agentSession';

export async function POST(req: NextRequest) {
  const session = getSession();

  let body: { extend?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { extend } = body;

  if (session.status !== 'budget_paused') {
    return NextResponse.json({ error: 'No budget pause pending' }, { status: 400 });
  }

  const run = session.currentRun;
  if (!run?.budgetResolve) {
    return NextResponse.json({ error: 'No budget resolve callback' }, { status: 400 });
  }

  session.status = 'running';
  const resolve = run.budgetResolve;
  run.budgetResolve = null;
  resolve(extend === true);

  return NextResponse.json({ ok: true });
}
