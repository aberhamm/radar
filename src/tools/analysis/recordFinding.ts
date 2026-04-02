import type { Finding, FindingCategory, Severity, Evidence, DocRef } from '../../types/findings.js';
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

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CATEGORIES = new Set([
  'stack', 'cms-integration', 'preview-editing', 'configuration',
  'security', 'architecture', 'dependencies', 'deployment',
  'routing', 'data-fetching', 'nextjs',
]);

/**
 * Check if an object looks like a valid finding (has id, category, severity with correct types).
 */
function isFindingLike(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.category === 'string' &&
    typeof o.severity === 'string' &&
    typeof o.title === 'string' &&
    VALID_SEVERITIES.has(o.severity) &&
    VALID_CATEGORIES.has(o.category)
  );
}

/**
 * Safely construct an Evidence item from an untyped object.
 */
function toEvidence(obj: unknown): Evidence | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.filePath !== 'string' || typeof o.description !== 'string') return null;
  return {
    filePath: o.filePath,
    description: o.description,
    ...(typeof o.lineNumber === 'number' ? { lineNumber: o.lineNumber } : {}),
    ...(typeof o.snippet === 'string' ? { snippet: o.snippet } : {}),
  };
}

/**
 * Safely construct a DocRef item from an untyped object.
 */
function toDocRef(obj: unknown): DocRef | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.url !== 'string' || typeof o.title !== 'string' || typeof o.relevance !== 'string') return null;
  return { url: o.url, title: o.title, relevance: o.relevance };
}

/**
 * Build a type-safe Finding from a validated object (must have passed isFindingLike).
 * Provides defaults for optional/missing fields instead of casting.
 */
function buildFinding(obj: Record<string, unknown>): Finding {
  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence.map(toEvidence).filter((e): e is Evidence => e !== null)
    : [];

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === 'string')
    : [];

  const documentationRefs = Array.isArray(obj.documentationRefs)
    ? obj.documentationRefs.map(toDocRef).filter((d): d is DocRef => d !== null)
    : undefined;

  return {
    id: obj.id as string,
    category: obj.category as FindingCategory,
    severity: obj.severity as Severity,
    title: obj.title as string,
    description: typeof obj.description === 'string' ? obj.description : '',
    evidence,
    tags,
    ...(typeof obj.investigationNote === 'string' ? { investigationNote: obj.investigationNote } : {}),
    ...(documentationRefs && documentationRefs.length > 0 ? { documentationRefs } : {}),
  };
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
      return findings.map(buildFinding);
    }
  }

  // Case: top-level is an array (shouldn't happen with JSON.parse on object, but defensive)
  if (Array.isArray(input)) {
    const findings = (input as unknown[]).filter(isFindingLike);
    if (findings.length > 0) {
      return findings.map(buildFinding);
    }
  }

  // Case: numeric keys at top level or under finding — array serialized as object
  const numericKeys = Object.keys(input).filter((k) => /^\d+$/.test(k));
  if (numericKeys.length > 0) {
    const findings = numericKeys
      .map((k) => input[k])
      .filter(isFindingLike);
    if (findings.length > 0) {
      return findings.map(buildFinding);
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
        return findings.map(buildFinding);
      }
    }

    // Double-nested: { finding: { finding: { ... } } }
    if ('finding' in candObj && !('id' in candObj)) {
      const inner = candObj.finding;
      if (isFindingLike(inner)) {
        return [buildFinding(inner as Record<string, unknown>)];
      }
    }

    // Standard: { finding: { id, category, ... } }
    if (isFindingLike(candObj)) {
      return [buildFinding(candObj)];
    }
  }

  // Flat: { id, category, severity, ... }
  if (isFindingLike(input)) {
    return [buildFinding(input)];
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
  const findings = extractFindings(input as Record<string, unknown>);

  for (const finding of findings) {
    state.findings.push(finding);
  }

  return {
    findingId: findings.map((f) => f.id).join(', '),
    totalFindings: state.findings.length,
    ...(findings.length > 1 ? { recordedCount: findings.length } : {}),
  };
}
