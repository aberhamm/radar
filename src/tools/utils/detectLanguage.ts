/**
 * Detect language from file extension.
 */

const EXT_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.env': 'env',
  '.sh': 'shell',
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXT_MAP[ext] ?? 'text';
}
