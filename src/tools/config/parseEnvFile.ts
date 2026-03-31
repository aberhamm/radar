import type { ParseEnvFileInput, ParseEnvFileOutput, EnvVar } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

export async function parseEnvFile(
  repoRoot: string,
  input: ParseEnvFileInput,
): Promise<ParseEnvFileOutput> {
  const result = await resolveAndRead(repoRoot, input.path);

  if (isResolveError(result)) {
    return { variables: [], error: result.error };
  }

  const variables: EnvVar[] = [];
  const lines = result.content.split('\n');
  let lastComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) {
      lastComment = trimmed.slice(1).trim();
      continue;
    }

    if (!trimmed || !trimmed.includes('=')) {
      lastComment = '';
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    const name = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (!name) continue;

    variables.push({
      name,
      hasDefault: value.length > 0,
      ...(lastComment ? { comment: lastComment } : {}),
    });
    lastComment = '';
  }

  return { variables };
}
