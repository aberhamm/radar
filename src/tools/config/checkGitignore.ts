import type { CheckGitignoreInput, CheckGitignoreOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

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
      ignored: lines.some((line) => line === pattern || line === pattern + '/'),
    })),
    exists: true,
  };
}
