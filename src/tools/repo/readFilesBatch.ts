import type { ReadFilesBatchInput, ReadFilesBatchOutput, ReadFileOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';
import { detectLanguage } from '../utils/detectLanguage.js';

const DEFAULT_MAX_LINES = 500;

export async function readFilesBatch(
  repoRoot: string,
  input: ReadFilesBatchInput,
): Promise<ReadFilesBatchOutput> {
  const maxLines = input.maxLinesPerFile ?? DEFAULT_MAX_LINES;

  const files: ReadFileOutput[] = await Promise.all(
    input.paths.map(async (filePath) => {
      const result = await resolveAndRead(repoRoot, filePath, maxLines);

      if (isResolveError(result)) {
        return {
          path: filePath,
          content: '',
          lineCount: 0,
          language: 'text',
          error: result.error,
        };
      }

      return {
        path: filePath,
        content: result.content,
        lineCount: result.lineCount,
        language: detectLanguage(filePath),
      };
    }),
  );

  return { files };
}
