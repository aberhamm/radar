/**
 * Inlined diff logic from src/commands/diff.ts for dashboard use.
 * Runs server-side only (API route). Uses node:crypto for fingerprints.
 */

import { createHash } from 'node:crypto';

// ── Types (matching raw findings from disk) ────────────────────

export interface RawFinding {
  id: string;
  category: string;
  severity: string;
  title: string;
  description?: string;
  evidence?: Array<{ filePath: string; snippet?: string; description?: string; lineNumber?: number }>;
  investigationNote?: string;
  tags?: string[];
  fingerprint?: string;
  confidence?: number;
}

export interface DiffResult {
  newFindings: RawFinding[];
  resolvedFindings: RawFinding[];
  persistentFindings: RawFinding[];
  summary: string;
}

// ── Fingerprint logic ──────────────────────────────────────────

function computeFallbackFingerprint(f: RawFinding): string {
  const normalizedTitle = f.title.toLowerCase().replace(/\s+/g, ' ').trim();
  const firstFile = f.evidence && f.evidence.length > 0
    ? f.evidence[0].filePath.replace(/\\/g, '/')
    : '';
  const input = `${f.category}:${firstFile}:${normalizedTitle}`;
  return createHash('sha256').update(input).digest('hex');
}

function getFingerprint(f: RawFinding): string {
  return f.fingerprint || computeFallbackFingerprint(f);
}

// ── Diff ───────────────────────────────────────────────────────

export function diffFindings(previous: RawFinding[], current: RawFinding[]): DiffResult {
  const prevMap = new Map<string, RawFinding>();
  for (const f of previous) {
    prevMap.set(getFingerprint(f), f);
  }

  const currMap = new Map<string, RawFinding>();
  for (const f of current) {
    currMap.set(getFingerprint(f), f);
  }

  const newFindings: RawFinding[] = [];
  const persistentFindings: RawFinding[] = [];

  for (const [fp, f] of currMap) {
    if (prevMap.has(fp)) {
      persistentFindings.push(f);
    } else {
      newFindings.push(f);
    }
  }

  const resolvedFindings: RawFinding[] = [];
  for (const [fp, f] of prevMap) {
    if (!currMap.has(fp)) {
      resolvedFindings.push(f);
    }
  }

  const parts: string[] = [];
  if (newFindings.length > 0) parts.push(`+${newFindings.length} new`);
  if (resolvedFindings.length > 0) parts.push(`-${resolvedFindings.length} resolved`);
  if (persistentFindings.length > 0) parts.push(`${persistentFindings.length} persistent`);
  const summary = parts.length > 0 ? parts.join(', ') : 'No changes';

  return { newFindings, resolvedFindings, persistentFindings, summary };
}
