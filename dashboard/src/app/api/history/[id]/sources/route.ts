import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  loadRunSources,
  loadRunFindings,
  findRunById,
  findChildRunIds,
} from '@/lib/agentSession';
import type { SourceFile } from '@/lib/useSourceFiles';

const MAX_SOURCE_BYTES = 500_000;

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss',
    '.html': 'html', '.yml': 'yaml', '.yaml': 'yaml', '.xml': 'xml',
    '.graphql': 'graphql', '.gql': 'graphql', '.sh': 'bash',
    '.env': 'plaintext', '.config': 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

/** Reconstruct sources by reading evidence files from the repo on disk. */
function rebuildSourcesFromFindings(
  findings: unknown[],
  repoPath: string,
): Record<string, SourceFile> | null {
  const resolvedRepo = path.resolve(repoPath);
  if (!fs.existsSync(resolvedRepo)) return null;

  const filePaths = new Set<string>();
  for (const f of findings as Array<{ evidence?: Array<{ filePath?: string }> }>) {
    for (const ev of f.evidence ?? []) {
      if (ev.filePath) filePaths.add(ev.filePath);
    }
  }
  if (filePaths.size === 0) return null;

  const sources: Record<string, SourceFile> = {};
  for (const fp of filePaths) {
    try {
      const abs = path.resolve(resolvedRepo, fp);
      if (!abs.startsWith(resolvedRepo)) continue;
      const raw = fs.readFileSync(abs, 'utf-8');
      if (raw.length > MAX_SOURCE_BYTES) continue;
      sources[fp] = { content: raw, lineCount: raw.split('\n').length, language: detectLanguage(fp) };
    } catch { /* file may no longer exist */ }
  }
  return Object.keys(sources).length > 0 ? sources : null;
}

function resolveSourcesForRecord(
  record: { result?: { sources?: Record<string, SourceFile> }; repoPath?: string; _dirPath?: string; id: string },
): Record<string, SourceFile> | null {
  if (record.result?.sources) return record.result.sources;

  const diskSources = loadRunSources(record as Parameters<typeof loadRunSources>[0]);
  if (diskSources) return diskSources;

  // Fallback: rebuild from evidence files in the repo
  if (record.repoPath) {
    const findings = loadRunFindings(record as Parameters<typeof loadRunFindings>[0]);
    if (findings.length > 0) {
      return rebuildSourcesFromFindings(findings, record.repoPath);
    }
  }
  return null;
}

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

  // For virtual parent IDs (multi-goal runs), aggregate sources from children
  if (!record) {
    const childIds = findChildRunIds(id);
    if (childIds.length === 0) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    const merged: Record<string, SourceFile> = {};
    for (const childId of childIds) {
      const childRecord = findRunById(childId);
      if (!childRecord) continue;
      const childSources = resolveSourcesForRecord(childRecord);
      if (childSources) Object.assign(merged, childSources);
    }
    return NextResponse.json(
      { sources: Object.keys(merged).length > 0 ? merged : null },
      { headers: { 'Cache-Control': 'public, max-age=300, immutable' } },
    );
  }

  const cacheHeaders: HeadersInit = record.completedAt
    ? { 'Cache-Control': 'public, max-age=300, immutable' }
    : { 'Cache-Control': 'no-cache' };

  const sources = resolveSourcesForRecord(record);
  return NextResponse.json({ sources }, { headers: cacheHeaders });
}
