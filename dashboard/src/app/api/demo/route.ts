import { NextResponse } from 'next/server';
import demoRun from '@/fixtures/demo-run.json';

export async function GET() {
  if (process.env.DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Demo mode is not enabled' }, { status: 404 });
  }

  return NextResponse.json(demoRun);
}
