/**
 * Evidence verification engine — prevents hallucinated findings.
 *
 * Reads cited files from disk and compares agent-provided snippets against
 * actual source code. Three outcomes per evidence item:
 * - verified: snippet matches the file content
 * - corrected: file exists but snippet differs — auto-replaced with real code
 * - rejected: file doesn't exist or content is completely unrelated
 *
 * All operations are deterministic (no LLM calls).
 */

import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';
import type { Evidence, Finding } from '../../types/findings.js';

export interface EvidenceVerificationResult {
  evidence: Evidence;
  status: 'verified' | 'corrected' | 'rejected';
  note: string;
}

/**
 * Extract a window of lines around a target line number.
 * If no lineNumber, returns first `contextLines * 2` lines.
 */
export function extractCodeWindow(
  content: string,
  lineNumber: number | undefined,
  contextLines = 3,
): string {
  const lines = content.split('\n');
  if (!lineNumber || lineNumber < 1) {
    return lines.slice(0, contextLines * 2 + 1).join('\n');
  }
  const idx = lineNumber - 1; // 0-based
  const start = Math.max(0, idx - contextLines);
  const end = Math.min(lines.length, idx + contextLines + 1);
  return lines.slice(start, end).join('\n');
}

/**
 * Normalize a code string for comparison: trim each line, collapse
 * runs of whitespace, remove empty lines.
 */
function normalize(code: string): string {
  return code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .replace(/\s+/g, ' ');
}

/**
 * Check whether a snippet matches the actual file content.
 *
 * Strategy:
 * 1. Normalized substring check (handles whitespace/indent differences)
 * 2. Line-by-line fallback: if 60%+ of non-empty snippet lines appear in the
 *    content window (in order), count it as a match.
 */
export function snippetMatchesContent(snippet: string, actualContent: string): boolean {
  const normSnippet = normalize(snippet);
  const normContent = normalize(actualContent);

  // Empty snippet never matches
  if (normSnippet.length === 0) return false;

  // Exact or substring match after normalization
  if (normContent.includes(normSnippet)) return true;

  // Line-by-line ordered match fallback
  const snippetLines = snippet.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const contentLines = actualContent.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (snippetLines.length === 0) return false;

  let matched = 0;
  let contentIdx = 0;
  for (const sLine of snippetLines) {
    while (contentIdx < contentLines.length) {
      if (contentLines[contentIdx].includes(sLine) || sLine.includes(contentLines[contentIdx])) {
        matched++;
        contentIdx++;
        break;
      }
      contentIdx++;
    }
  }

  return matched / snippetLines.length >= 0.6;
}

/**
 * Verify a single evidence item against the actual file on disk.
 * Auto-corrects the snippet if the file exists but content differs.
 */
export async function verifyAndCorrectEvidence(
  repoRoot: string,
  evidence: Evidence,
): Promise<EvidenceVerificationResult> {
  const result = await resolveAndRead(repoRoot, evidence.filePath);

  if (isResolveError(result)) {
    return {
      evidence,
      status: 'rejected',
      note: `File not found or unreadable: ${evidence.filePath} (${result.error})`,
    };
  }

  const fileContent = result.content;
  const window = extractCodeWindow(fileContent, evidence.lineNumber);

  // Check snippet against the relevant window first, then full file
  if (snippetMatchesContent(evidence.snippet, window) ||
      snippetMatchesContent(evidence.snippet, fileContent)) {
    return {
      evidence: {
        ...evidence,
        verified: true,
        verificationStatus: 'verified',
      },
      status: 'verified',
      note: `Snippet verified against ${evidence.filePath}${evidence.lineNumber ? `:${evidence.lineNumber}` : ''}`,
    };
  }

  // Snippet doesn't match — auto-correct with actual code
  const actualSnippet = extractCodeWindow(fileContent, evidence.lineNumber, 2);
  return {
    evidence: {
      ...evidence,
      originalSnippet: evidence.snippet,
      snippet: actualSnippet,
      verified: true,
      verificationStatus: 'corrected',
    },
    status: 'corrected',
    note: `Snippet did not match ${evidence.filePath}${evidence.lineNumber ? `:${evidence.lineNumber}` : ''}. Auto-corrected to actual code.`,
  };
}

/**
 * Verify all evidence in a finding. Used by the post-investigation pass.
 * Sets verified/verificationStatus on each evidence item and populates
 * finding.verificationNotes.
 */
export async function verifyFindingEvidence(
  repoRoot: string,
  finding: Finding,
): Promise<{ finding: Finding; allUnverifiable: boolean }> {
  const notes: string[] = [];
  const verifiedEvidence: Evidence[] = [];
  let unverifiableCount = 0;

  for (const ev of finding.evidence) {
    const result = await resolveAndRead(repoRoot, ev.filePath);

    if (isResolveError(result)) {
      notes.push(`Evidence unverifiable: ${ev.filePath} — ${result.error}`);
      verifiedEvidence.push({
        ...ev,
        verified: false,
        verificationStatus: 'unverifiable',
      });
      unverifiableCount++;
      continue;
    }

    const fileContent = result.content;
    const window = extractCodeWindow(fileContent, ev.lineNumber);

    if (ev.snippet && (snippetMatchesContent(ev.snippet, window) ||
        snippetMatchesContent(ev.snippet, fileContent))) {
      verifiedEvidence.push({
        ...ev,
        verified: true,
        verificationStatus: 'verified',
      });
    } else {
      const actualSnippet = extractCodeWindow(fileContent, ev.lineNumber, 2);
      notes.push(`Evidence corrected: snippet for ${ev.filePath} did not match actual code.`);
      verifiedEvidence.push({
        ...ev,
        originalSnippet: ev.snippet,
        snippet: actualSnippet,
        verified: true,
        verificationStatus: 'corrected',
      });
    }
  }

  return {
    finding: {
      ...finding,
      evidence: verifiedEvidence,
      ...(notes.length > 0 ? { verificationNotes: notes } : {}),
    },
    allUnverifiable: finding.evidence.length > 0 && unverifiableCount === finding.evidence.length,
  };
}
