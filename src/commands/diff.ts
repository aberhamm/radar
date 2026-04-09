/**
 * radar diff <run-a> <run-b> — compare two findings JSON files.
 *
 * Matching strategy:
 *   1. Primary: match by `fingerprint` field
 *   2. Fallback: sha256(category + firstFilePath + normalizedTitle)
 *
 * Output: New / Resolved / Persistent findings with summary.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Finding } from '../types/findings.js';

// ── Diff result ─────────────────────────────────────────────────────────

export interface DiffResult {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  persistentFindings: Finding[];
  summary: string;
}

// ── Fingerprint fallback ────────────────────────────────────────────────

function computeFallbackFingerprint(f: Finding): string {
  const normalizedTitle = f.title.toLowerCase().replace(/\s+/g, ' ').trim();
  const firstFile = f.evidence.length > 0
    ? f.evidence[0].filePath.replace(/\\/g, '/')
    : '';
  const input = `${f.category}:${firstFile}:${normalizedTitle}`;
  return createHash('sha256').update(input).digest('hex');
}

function getFingerprint(f: Finding): string {
  return f.fingerprint || computeFallbackFingerprint(f);
}

// ── Diff ────────────────────────────────────────────────────────────────

export function diffFindings(previous: Finding[], current: Finding[]): DiffResult {
  const prevMap = new Map<string, Finding>();
  for (const f of previous) {
    prevMap.set(getFingerprint(f), f);
  }

  const currMap = new Map<string, Finding>();
  for (const f of current) {
    currMap.set(getFingerprint(f), f);
  }

  const newFindings: Finding[] = [];
  const persistentFindings: Finding[] = [];

  for (const [fp, f] of currMap) {
    if (prevMap.has(fp)) {
      persistentFindings.push(f);
    } else {
      newFindings.push(f);
    }
  }

  const resolvedFindings: Finding[] = [];
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

// ── CLI handler ─────────────────────────────────────────────────────────

export function handleDiff(opts: { runA: string; runB: string }): number {
  // Load and parse both files
  let previousFindings: Finding[];
  let currentFindings: Finding[];

  try {
    const rawA = fs.readFileSync(opts.runA, 'utf-8');
    previousFindings = JSON.parse(rawA);
    if (!Array.isArray(previousFindings)) {
      throw new Error('Expected an array of findings');
    }
  } catch (err) {
    console.error(`Failed to read run-a (${opts.runA}): ${(err as Error).message}`);
    return 2;
  }

  try {
    const rawB = fs.readFileSync(opts.runB, 'utf-8');
    currentFindings = JSON.parse(rawB);
    if (!Array.isArray(currentFindings)) {
      throw new Error('Expected an array of findings');
    }
  } catch (err) {
    console.error(`Failed to read run-b (${opts.runB}): ${(err as Error).message}`);
    return 2;
  }

  const result = diffFindings(previousFindings, currentFindings);

  console.log(`\n--- Findings Diff ---\n`);
  console.log(`  Previous: ${previousFindings.length} findings`);
  console.log(`  Current:  ${currentFindings.length} findings`);
  console.log(`  Summary:  ${result.summary}\n`);

  if (result.newFindings.length > 0) {
    console.log('  New:');
    for (const f of result.newFindings) {
      console.log(`    + [${f.severity.toUpperCase()}] ${f.title}`);
    }
    console.log('');
  }

  if (result.resolvedFindings.length > 0) {
    console.log('  Resolved:');
    for (const f of result.resolvedFindings) {
      console.log(`    - [${f.severity.toUpperCase()}] ${f.title}`);
    }
    console.log('');
  }

  if (result.persistentFindings.length > 0) {
    console.log(`  Persistent: ${result.persistentFindings.length} findings unchanged`);
    console.log('');
  }

  return 0;
}
