import type { Finding } from '../../types/findings.js';
import type { AgentState } from '../../types/state.js';

export interface RecordFindingInput {
  finding: Finding;
}

export interface RecordFindingOutput {
  findingId: string;
  totalFindings: number;
  /** When the LLM passes multiple findings in one call, report how many were recorded */
  recordedCount?: number;
}

/**
 * Check if an object looks like a valid finding (has id, category, severity).
 */
function isFindingLike(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'category' in obj &&
    'severity' in obj
  );
}

/**
 * Extract finding(s) from LLM-provided input.
 * Handles multiple argument shapes:
 * - { finding: { id, category, ... } }       — correct per schema
 * - { id, category, ... }                     — flat (no wrapper)
 * - { finding: { finding: { ... } } }         — double-nested
 * - { finding: [ {...}, {...} ] }              — array of findings (LLM batching)
 * - [ {...}, {...} ]                           — top-level array (parsed from JSON array)
 * - { "0": {...}, "1": {...}, ... }            — array serialized as object keys
 */
function extractFindings(input: Record<string, unknown>): Finding[] {
  const candidate = input.finding;

  // Case: finding is an array of findings
  if (Array.isArray(candidate)) {
    const findings = candidate.filter(isFindingLike);
    if (findings.length > 0) {
      return findings as unknown as Finding[];
    }
  }

  // Case: top-level is an array (shouldn't happen with JSON.parse on object, but defensive)
  if (Array.isArray(input)) {
    const findings = (input as unknown[]).filter(isFindingLike);
    if (findings.length > 0) {
      return findings as unknown as Finding[];
    }
  }

  // Case: numeric keys at top level or under finding — array serialized as object
  const numericKeys = Object.keys(input).filter((k) => /^\d+$/.test(k));
  if (numericKeys.length > 0) {
    const findings = numericKeys
      .map((k) => input[k])
      .filter(isFindingLike);
    if (findings.length > 0) {
      return findings as unknown as Finding[];
    }
  }

  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const candObj = candidate as Record<string, unknown>;

    // Check for numeric keys under finding (array-as-object)
    const candNumKeys = Object.keys(candObj).filter((k) => /^\d+$/.test(k));
    if (candNumKeys.length > 0) {
      const findings = candNumKeys
        .map((k) => candObj[k])
        .filter(isFindingLike);
      if (findings.length > 0) {
        return findings as unknown as Finding[];
      }
    }

    // Double-nested: { finding: { finding: { ... } } }
    if ('finding' in candObj && !('id' in candObj)) {
      const inner = candObj.finding;
      if (isFindingLike(inner)) {
        return [inner as unknown as Finding];
      }
    }

    // Standard: { finding: { id, category, ... } }
    if (isFindingLike(candObj)) {
      return [candObj as unknown as Finding];
    }
  }

  // Flat: { id, category, severity, ... }
  if (isFindingLike(input)) {
    return [input as unknown as Finding];
  }

  const candidateKeys = candidate && typeof candidate === 'object' ? Object.keys(candidate as object) : [];
  const topKeys = Object.keys(input);
  throw new Error(
    `Finding requires id, category, and severity. ` +
    `finding keys: [${candidateKeys.join(', ')}], top keys: [${topKeys.join(', ')}]`,
  );
}

/**
 * Record finding(s) into the agent state. Returns the finding ID(s)
 * and updated total count. This is the only tool that mutates state.
 *
 * Handles the common LLM behavior of batching multiple findings
 * into a single tool call (array or numeric-keyed object).
 */
export function recordFinding(
  state: AgentState,
  input: RecordFindingInput,
): RecordFindingOutput {
  const findings = extractFindings(input as unknown as Record<string, unknown>);

  for (const finding of findings) {
    state.findings.push(finding);
  }

  return {
    findingId: findings.map((f) => f.id).join(', '),
    totalFindings: state.findings.length,
    ...(findings.length > 1 ? { recordedCount: findings.length } : {}),
  };
}
