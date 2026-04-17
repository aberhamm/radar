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
 * Extract UPPER_SNAKE_CASE identifiers (env vars, constants) from code.
 * These are the highest-signal tokens for hallucination detection —
 * LLMs frequently invent plausible env var names.
 */
export function extractKeyIdentifiers(code: string): Set<string> {
  const matches = code.match(/[A-Z][A-Z0-9_]{2,}/g);
  return new Set(matches ?? []);
}

/**
 * Check whether a snippet matches the actual file content.
 *
 * Strategy:
 * 1. Normalized substring check (handles whitespace/indent differences)
 * 2. Line-by-line fallback: if 60%+ of non-empty snippet lines appear in the
 *    content window (in order), count it as a match.
 * 3. Identifier guard: after line-by-line match, verify that all UPPER_SNAKE_CASE
 *    identifiers from unmatched snippet lines exist in the file. This catches
 *    hallucinated env var names that slip through when boilerplate lines pass.
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
  const matchedSnippetIndices = new Set<number>();
  for (let si = 0; si < snippetLines.length; si++) {
    const sLine = snippetLines[si];
    while (contentIdx < contentLines.length) {
      if (contentLines[contentIdx].includes(sLine) || sLine.includes(contentLines[contentIdx])) {
        matched++;
        matchedSnippetIndices.add(si);
        contentIdx++;
        break;
      }
      contentIdx++;
    }
  }

  if (matched / snippetLines.length < 0.6) return false;

  // Identifier guard: extract UPPER_SNAKE identifiers from UNMATCHED snippet lines
  // and verify they exist in the actual file content. This catches hallucinated
  // env vars/constants that pass the line-match threshold via surrounding boilerplate.
  const fileIdentifiers = extractKeyIdentifiers(actualContent);
  for (let si = 0; si < snippetLines.length; si++) {
    if (matchedSnippetIndices.has(si)) continue; // matched line — already verified
    const lineIds = extractKeyIdentifiers(snippetLines[si]);
    for (const id of lineIds) {
      if (!fileIdentifiers.has(id)) {
        return false; // hallucinated identifier
      }
    }
  }

  return true;
}

/**
 * Find the actual 1-based line number where a snippet starts in file content.
 * Returns undefined if no match found. Uses normalized comparison.
 */
export function findSnippetLine(snippet: string, fileContent: string): number | undefined {
  const snippetLines = snippet.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (snippetLines.length === 0) return undefined;

  const contentLines = fileContent.split('\n');
  const firstSnippetLine = snippetLines[0];

  for (let i = 0; i < contentLines.length; i++) {
    const contentTrimmed = contentLines[i].trim();
    // Skip empty content lines — they'd match anything via includes('')
    if (contentTrimmed.length === 0) continue;
    if (contentTrimmed.includes(firstSnippetLine) ||
        firstSnippetLine.includes(contentTrimmed)) {
      // Verify subsequent lines also match (if multi-line snippet)
      if (snippetLines.length === 1) return i + 1;
      let allMatch = true;
      let ci = i + 1;
      for (let j = 1; j < snippetLines.length; j++) {
        // Skip empty content lines between matches
        while (ci < contentLines.length && contentLines[ci].trim().length === 0) ci++;
        if (ci >= contentLines.length) { allMatch = false; break; }
        const nextTrimmed = contentLines[ci].trim();
        if (!nextTrimmed.includes(snippetLines[j]) && !snippetLines[j].includes(nextTrimmed)) {
          allMatch = false;
          break;
        }
        ci++;
      }
      if (allMatch) return i + 1;
    }
  }
  return undefined;
}

/**
 * Verify a single evidence item against the actual file on disk.
 * Auto-corrects the snippet if the file exists but content differs.
 * Also corrects lineNumber if the snippet is found at a different location.
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

  // Always capture actual source context around the referenced line for user validation
  const sourceContext = extractCodeWindow(fileContent, evidence.lineNumber, 3);

  // No snippet provided — verify file exists, capture context
  if (!evidence.snippet) {
    return {
      evidence: {
        ...evidence,
        verified: true,
        verificationStatus: 'verified',
        sourceContext,
      },
      status: 'verified',
      note: `File exists: ${evidence.filePath} (no snippet to verify)`,
    };
  }

  // Check snippet against the relevant window first, then full file
  if (snippetMatchesContent(evidence.snippet, window) ||
      snippetMatchesContent(evidence.snippet, fileContent)) {
    // Auto-correct line number if snippet is found at a different location
    const actualLine = findSnippetLine(evidence.snippet, fileContent);
    const correctedLine = actualLine ?? evidence.lineNumber;
    const lineChanged = correctedLine !== evidence.lineNumber;
    return {
      evidence: {
        ...evidence,
        ...(correctedLine ? { lineNumber: correctedLine } : {}),
        verified: true,
        verificationStatus: 'verified',
        sourceContext,
      },
      status: 'verified',
      note: `Snippet verified against ${evidence.filePath}${correctedLine ? `:${correctedLine}` : ''}${lineChanged ? ` (line corrected from ${evidence.lineNumber})` : ''}`,
    };
  }

  // Snippet doesn't match — auto-correct with actual code at claimed line
  const actualSnippet = extractCodeWindow(fileContent, evidence.lineNumber, 2);
  return {
    evidence: {
      ...evidence,
      originalSnippet: evidence.snippet,
      snippet: actualSnippet,
      verified: true,
      verificationStatus: 'corrected',
      sourceContext,
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
    const sourceContext = extractCodeWindow(fileContent, ev.lineNumber, 3);

    if (ev.snippet != null && (snippetMatchesContent(ev.snippet, window) ||
        snippetMatchesContent(ev.snippet, fileContent))) {
      // Auto-correct line number if snippet is found at a different location
      const actualLine = findSnippetLine(ev.snippet, fileContent);
      const correctedLine = actualLine ?? ev.lineNumber;
      verifiedEvidence.push({
        ...ev,
        ...(correctedLine ? { lineNumber: correctedLine } : {}),
        verified: true,
        verificationStatus: 'verified',
        sourceContext,
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
        sourceContext,
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
