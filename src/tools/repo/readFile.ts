import type { ReadFileInput, ReadFileOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';
import { detectLanguage } from '../utils/detectLanguage.js';

const DEFAULT_MAX_LINES = 500;

export async function readFile(
  repoRoot: string,
  input: ReadFileInput,
): Promise<ReadFileOutput> {
  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES;
  const result = await resolveAndRead(repoRoot, input.path, maxLines, input.startLine);

  if (isResolveError(result)) {
    return {
      path: input.path,
      content: '',
      lineCount: 0,
      language: 'text',
      error: result.error,
    };
  }

  return {
    path: input.path,
    content: result.content,
    lineCount: result.lineCount,
    language: detectLanguage(input.path),
  };
}
