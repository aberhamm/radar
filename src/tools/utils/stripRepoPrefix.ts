import path from 'node:path';

/**
 * Strip the repo root prefix from an absolute path, returning a repo-relative path.
 * Handles both forward and back slashes (Windows). If the path doesn't start with
 * repoRoot, returns it unchanged.
 */
export function stripRepoPrefix(filePath: string, repoRoot: string): string {
  const normalizedFile = path.normalize(filePath);
  const normalizedRoot = path.normalize(repoRoot);

  if (normalizedFile.startsWith(normalizedRoot)) {
    let relative = normalizedFile.slice(normalizedRoot.length);
    // Remove leading separator
    relative = relative.replace(/^[/\\]+/, '');
    return relative || '.';
  }

  return filePath;
}
