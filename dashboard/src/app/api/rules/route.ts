import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const RULES_DIR = path.join(process.cwd(), '..', 'src', 'rules');

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const goal = searchParams.get('goal') || 'onboarding';

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
