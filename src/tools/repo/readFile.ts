import type { ReadFileInput, ReadFileOutput, ToolErrorCode } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';
import { detectLanguage } from '../utils/detectLanguage.js';

const DEFAULT_MAX_LINES = 500;

function classifyReadError(message: string): ToolErrorCode {
  if (message.includes('not found') || message.includes('ENOENT')) return 'FILE_NOT_FOUND';
  if (message.includes('traversal')) return 'PATH_TRAVERSAL';
  if (message.includes('Binary file')) return 'BINARY_FILE';
  if (message.includes('EACCES') || message.includes('EPERM')) return 'PERMISSION_DENIED';
  return 'INTERNAL_ERROR';
}

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
      errorCode: classifyReadError(result.error),
    };
  }

  return {
    path: input.path,
    content: result.content,
    lineCount: result.lineCount,
    language: detectLanguage(input.path),
  };
}
