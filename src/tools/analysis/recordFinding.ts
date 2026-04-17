import type { Finding, FindingCategory, Severity, Evidence, DocRef } from '../../types/findings.js';
import type { AgentState } from '../../types/state.js';
import { verifyAndCorrectEvidence } from './verifyEvidence.js';
import { computeFingerprint } from '../../ci/fingerprintUtils.js';

export interface RecordFindingInput {
  finding: Finding;
}

export interface RecordFindingOutput {
  findingId: string;
  totalFindings: number;
  /** When the LLM passes multiple findings in one call, report how many were recorded */
  recordedCount?: number;
  /** Verification warnings returned to the agent */
  warnings?: string[];
  /** How many evidence items were stripped due to verification failure */
  rejectedEvidenceCount?: number;
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CATEGORIES = new Set([
  'stack', 'cms-integration', 'preview-editing', 'configuration',
  'security', 'architecture', 'dependencies', 'deployment',
  'routing', 'data-fetching', 'nextjs',
  'performance', 'accessibility', 'forms', 'aria',
  'auth', 'secrets', 'input-validation', 'data-exposure', 'testing', 'dx',
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
 * Normalize a file path for comparison against filesRead.
 * Strips leading ./ and normalizes separators.
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Safely construct an Evidence item from an untyped object.
 * Snippet is required — evidence without a snippet is rejected.
 */
function toEvidence(obj: unknown): Evidence | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.filePath !== 'string' || typeof o.description !== 'string') return null;
  // Snippet is required — reject evidence without it
  if (typeof o.snippet !== 'string' || o.snippet.trim() === '') return null;
  return {
    filePath: o.filePath,
    description: o.description,
    snippet: o.snippet,
    ...(typeof o.lineNumber === 'number' ? { lineNumber: o.lineNumber } : {}),
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

// Fingerprint computation is in src/ci/fingerprintUtils.ts (shared with diff.ts and githubIssues.ts)

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

  const confidence = typeof obj.confidence === 'number' && obj.confidence >= 1 && obj.confidence <= 10
    ? Math.round(obj.confidence)
    : undefined;

  const title = typeof obj.title === 'string' ? obj.title : '';
  const description = typeof obj.description === 'string' ? obj.description : '';
  const fingerprint = computeFingerprint(obj.category as string, title, evidence);

  return {
    id: obj.id as string,
    category: obj.category as FindingCategory,
    severity: obj.severity as Severity,
    ...(confidence !== undefined ? { confidence } : {}),
    title,
    description,
    evidence,
    tags,
    ...(typeof obj.investigationNote === 'string' ? { investigationNote: obj.investigationNote } : {}),
    ...(documentationRefs && documentationRefs.length > 0 ? { documentationRefs } : {}),
    fingerprint,
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
 * Extract specific claims from a finding description that should appear in evidence.
 * Returns package names (@scope/name), version numbers (X.Y.Z), and env var names.
 */
function extractDescriptionClaims(description: string): string[] {
  const claims: string[] = [];

  // Scoped package names: @scope/package-name
  const scopedPkgs = description.match(/@[\w-]+\/[\w.-]+/g);
  if (scopedPkgs) claims.push(...scopedPkgs);

  // Version numbers with context: v1.2.3, ^1.2.3, ~1.2, :^8, etc.
  // Only capture when they look like version claims (preceded by version-like context)
  const versions = description.match(/(?:[:v^~]|version\s*)\d+(?:\.\d+)+/gi);
  if (versions) {
    claims.push(...versions.map(v => v.replace(/^[:v^~]\s*|^version\s*/i, '')));
  }

  return claims;
}

/**
 * Check if key claims in the finding description are supported by evidence snippets.
 * Returns warnings for claims that appear in the description but not in any evidence.
 */
function checkDescriptionEvidenceCoherence(finding: Finding): string[] {
  const warnings: string[] = [];
  if (finding.evidence.length === 0) return warnings;

  const claims = extractDescriptionClaims(finding.description);
  if (claims.length === 0) return warnings;

  // Combine all evidence snippets + descriptions into one searchable string
  const evidenceText = finding.evidence
    .map(e => `${e.snippet} ${e.description}`)
    .join(' ');

  const unsupported = claims.filter(claim => !evidenceText.includes(claim));

  if (unsupported.length > 0) {
    warnings.push(
      `Description claims not found in evidence: ${unsupported.join(', ')}. ` +
      `Ensure evidence snippets contain the specific packages/versions you reference.`,
    );
  }

  return warnings;
}

/**
 * Record finding(s) into the agent state. Returns the finding ID(s)
 * and updated total count. This is the only tool that mutates state.
 *
 * Handles the common LLM behavior of batching multiple findings
 * into a single tool call (array or numeric-keyed object).
 *
 * Evidence verification:
 * - Checks each evidence item's filePath was read by the agent (filesRead)
 * - Reads the actual file and compares the snippet against real code
 * - Auto-corrects mismatched snippets, rejects evidence for missing files
 * - Checks that key claims in the description appear in evidence snippets
 */
export async function recordFinding(
  state: AgentState,
  input: RecordFindingInput,
): Promise<RecordFindingOutput> {
  const findings = extractFindings(input as unknown as Record<string, unknown>);
  const warnings: string[] = [];
  let rejectedEvidenceCount = 0;

  for (const finding of findings) {
    // Warn if finding has no evidence at all
    if (finding.evidence.length === 0) {
      warnings.push(
        `Finding "${finding.id}" has no evidence. Findings without evidence are unreliable. ` +
        `Add at least one evidence item with filePath, snippet, and description.`,
      );
    }

    // Push to state FIRST, before async evidence verification.
    // If agent.abort() fires mid-verification (e.g., assemble_output in same batch),
    // the finding still exists in state with its original evidence.
    // The post-loop verification pass in runner.ts will clean up unverifiable evidence.
    state.findings.push(finding);

    const verifiedEvidence: Evidence[] = [];

    for (const ev of finding.evidence) {
      const normalizedEvPath = normalizePath(ev.filePath);
      const wasRead = [...state.filesRead].some(
        (readPath) => normalizePath(readPath) === normalizedEvPath,
      );
      if (!wasRead) {
        warnings.push(
          `Evidence for "${ev.filePath}" rejected: file was never read by agent. ` +
          `Use read_file or read_files_batch first.`,
        );
        rejectedEvidenceCount++;
        continue;
      }

      const result = await verifyAndCorrectEvidence(state.repo.localPath, ev);

      if (result.status === 'rejected') {
        warnings.push(`Evidence rejected: ${result.note}`);
        rejectedEvidenceCount++;
        continue;
      }

      if (result.status === 'corrected') {
        warnings.push(`Evidence auto-corrected: ${result.note}`);
      }

      verifiedEvidence.push(result.evidence);
    }

    finding.evidence = verifiedEvidence;

    // After verification, check description-evidence coherence
    const coherenceWarnings = checkDescriptionEvidenceCoherence(finding);
    warnings.push(...coherenceWarnings);
  }

  return {
    findingId: findings.map((f) => f.id).join(', '),
    totalFindings: state.findings.length,
    ...(findings.length > 1 ? { recordedCount: findings.length } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(rejectedEvidenceCount > 0 ? { rejectedEvidenceCount } : {}),
  };
}
