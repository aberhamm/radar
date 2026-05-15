import { NextRequest, NextResponse } from 'next/server';
import demoRun from '@/fixtures/demo-run.json';
import demoMultigoal from '@/fixtures/demo-run-multigoal.json';

const DEMOS: Record<string, unknown> = {
  audit: demoRun,
  multigoal: demoMultigoal,
};

export async function GET(req: NextRequest) {
  const variant = req.nextUrl.searchParams.get('variant') ?? 'audit';
  const data = DEMOS[variant];
  if (!data) {
    return NextResponse.json(
      { error: `Unknown variant: ${variant}`, available: Object.keys(DEMOS) },
      { status: 404 },
    );
  }
  return NextResponse.json(data);
}
