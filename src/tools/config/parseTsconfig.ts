import type { ParseTsconfigInput, ParseTsconfigOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

/** Strip // and /* comments from JSON while preserving strings. */
function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — skip to end
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++; // skip escaped char
        j++;
      }
      result += text.slice(i, j + 1);
      i = j + 1;
    }
    // Line comment
    else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    }
    // Block comment
    else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    }
    else {
      result += text[i];
      i++;
    }
  }
  return result;
}

export async function parseTsconfig(
  repoRoot: string,
  input: ParseTsconfigInput,
): Promise<ParseTsconfigOutput> {
  const filePath = input.path ?? 'tsconfig.json';
  const result = await resolveAndRead(repoRoot, filePath);

  if (isResolveError(result)) {
    return { target: '', module: '', strict: false, error: result.error };
  }

  try {
    // Strip comments (tsconfig allows them) but preserve strings
    const cleaned = stripJsonComments(result.content);
    const config = JSON.parse(cleaned);
    const co = config.compilerOptions ?? {};

    return {
      target: co.target ?? '',
      module: co.module ?? '',
      paths: co.paths,
      baseUrl: co.baseUrl,
      strict: co.strict ?? false,
      jsx: co.jsx,
      plugins: co.plugins,
    };
  } catch {
    return { target: '', module: '', strict: false, error: `Failed to parse ${filePath}` };
  }
}
