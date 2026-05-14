import { NextResponse } from 'next/server';
import demoRun from '@/fixtures/demo-run.json';

export async function GET() {
  return NextResponse.json(demoRun);
}
