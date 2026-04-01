import type { CheckGitignoreInput, CheckGitignoreOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

/**
 * Check if a pattern is matched by any gitignore line.
 * Handles: exact match, trailing slash, leading slash, wildcard (*)
 * Does NOT handle full .gitignore spec (negation, **) — good enough for audit purposes.
 */
function isIgnored(pattern: string, gitignoreLines: string[]): boolean {
  for (const line of gitignoreLines) {
    // Exact match
    if (line === pattern || line === pattern + '/') return true;

    // Strip leading slash for comparison (anchoring)
    const normalizedLine = line.replace(/^\//, '').replace(/\/$/, '');
    const normalizedPattern = pattern.replace(/^\//, '').replace(/\/$/, '');

    if (normalizedLine === normalizedPattern) return true;

    // Simple wildcard matching: convert gitignore glob to regex
    if (line.includes('*')) {
      const regexStr = '^' + normalizedLine
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // escape regex chars (except *)
        .replace(/\*/g, '.*') + '$';
      try {
        if (new RegExp(regexStr).test(normalizedPattern)) return true;
      } catch {
        // Invalid regex — skip
      }
    }
  }
  return false;
}

export async function checkGitignore(
  repoRoot: string,
  input: CheckGitignoreInput,
): Promise<CheckGitignoreOutput> {
  const result = await resolveAndRead(repoRoot, '.gitignore');

  if (isResolveError(result)) {
    return {
      results: input.patterns.map((pattern) => ({ pattern, ignored: false })),
      exists: false,
    };
  }

  const lines = result.content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  return {
    results: input.patterns.map((pattern) => ({
      pattern,
      ignored: isIgnored(pattern, lines),
    })),
    exists: true,
  };
}
