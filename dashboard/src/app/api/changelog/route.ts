import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const filePath = path.resolve(process.cwd(), '..', 'CHANGELOG.md');
    const content = await readFile(filePath, 'utf-8');
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read changelog: ${(err as Error).message}`, content: '' },
      { status: 500 },
    );
  }
}
