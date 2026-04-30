import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const RULES_DIR = path.join(process.cwd(), '..', 'src', 'rules');

const ALLOWED_GOALS = ['onboarding', 'audit', 'migration', 'component-map', 'ci-check', 'security-review', 'nextjs', 'accessibility', 'performance'];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const goal = searchParams.get('goal') || 'onboarding';
  if (!ALLOWED_GOALS.includes(goal)) {
    return NextResponse.json({ error: 'Invalid goal' }, { status: 400 });
  }

  const files = ['core.md', `goal-${goal}.md`];
  const result: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(RULES_DIR, file);
    if (fs.existsSync(filePath)) {
      result[file] = fs.readFileSync(filePath, 'utf-8');
    }
  }

  return NextResponse.json(result);
}
