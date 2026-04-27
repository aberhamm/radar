/**
 * Finding deduplication — merges near-duplicate findings before output.
 *
 * Two findings are considered duplicates when they share:
 * 1. Same category AND severity
 * 2. Overlapping evidence file paths (50%+ Jaccard similarity)
 *
 * When merging, the longer description wins, evidence arrays are combined
 * (deduped by filePath + lineNumber), and tags are unioned.
 */

import type { Finding, Evidence } from '../../types/findings.js';

export interface DeduplicationResult {
  findings: Finding[];
  /** How many findings were merged away (absorbed into another) */
  mergedCount: number;
}

/**
 * Compute Jaccard similarity of evidence file paths between two findings.
 */
function evidenceOverlap(a: Finding, b: Finding): number {
  const pathsA = new Set(a.evidence.map((e) => e.filePath));
  const pathsB = new Set(b.evidence.map((e) => e.filePath));
  if (pathsA.size === 0 && pathsB.size === 0) return 0;
  let intersection = 0;
  for (const p of pathsA) {
    if (pathsB.has(p)) intersection++;
  }
  const union = new Set([...pathsA, ...pathsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Merge evidence arrays, deduplicating by filePath + lineNumber.
 */
function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const merged: Evidence[] = [];
  for (const ev of [...a, ...b]) {
    const key = `${ev.filePath}:${ev.lineNumber ?? 'none'}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ev);
    }
  }
  return merged;
}

/**
 * Merge two findings into one. Keeps the longer description, combines evidence and tags.
 */
function mergeFindings(primary: Finding, secondary: Finding): Finding {
  // Keep the higher confidence on merge (default to 7 for unset)
  const pConf = primary.confidence;
  const sConf = secondary.confidence;
  const mergedConfidence = pConf !== undefined || sConf !== undefined
    ? Math.max(pConf ?? 7, sConf ?? 7)
    : undefined;

  return {
    ...primary,
    ...(mergedConfidence !== undefined ? { confidence: mergedConfidence } : {}),
    description: primary.description.length >= secondary.description.length
      ? primary.description
      : secondary.description,
    evidence: mergeEvidence(primary.evidence, secondary.evidence),
    tags: [...new Set([...primary.tags, ...secondary.tags])],
    ...(primary.investigationNote || secondary.investigationNote
      ? { investigationNote: primary.investigationNote ?? secondary.investigationNote }
      : {}),
    ...(primary.verificationNotes || secondary.verificationNotes
      ? { verificationNotes: [...(primary.verificationNotes ?? []), ...(secondary.verificationNotes ?? [])] }
      : {}),
  };
}

/**
 * Deduplicate findings with overlapping evidence and matching category + severity.
 * Groups by (category, severity) first so only findings that could match are compared.
 */
export function deduplicateFindings(findings: Finding[]): DeduplicationResult {
  if (findings.length <= 1) return { findings: [...findings], mergedCount: 0 };

  // Group findings by (category, severity) — only compare within same group
  const groups = new Map<string, number[]>();
  for (let i = 0; i < findings.length; i++) {
    const key = `${findings[i].category}:${findings[i].severity}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(i);
  }

  const absorbed = new Set<number>();
  const result: Finding[] = [];

  for (const indices of groups.values()) {
    for (let gi = 0; gi < indices.length; gi++) {
      const i = indices[gi];
      if (absorbed.has(i)) continue;

      let current = findings[i];

      for (let gj = gi + 1; gj < indices.length; gj++) {
        const j = indices[gj];
        if (absorbed.has(j)) continue;

        const other = findings[j];

        // Must have 50%+ evidence file overlap
        if (evidenceOverlap(current, other) < 0.5) continue;

        // Merge
        current = mergeFindings(current, other);
        absorbed.add(j);
      }

      result.push(current);
    }
  }

  return {
    findings: result,
    mergedCount: absorbed.size,
  };
}
