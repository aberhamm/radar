import type { ParsePackageJsonInput, ParsePackageJsonOutput, PackageInfo } from '../../types/index.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

export async function parsePackageJson(
  repoRoot: string,
  input: ParsePackageJsonInput,
): Promise<ParsePackageJsonOutput> {
  const filePath = input.path ?? 'package.json';
  const result = await resolveAndRead(repoRoot, filePath);

  if (isResolveError(result)) {
    return {
      name: '', version: '', scripts: {},
      dependencies: [], devDependencies: [],
      error: result.error,
    };
  }

  try {
    const pkg = JSON.parse(result.content);
    return {
      name: pkg.name ?? '',
      version: pkg.version ?? '',
      scripts: pkg.scripts ?? {},
      dependencies: toPackageInfoList(pkg.dependencies, false),
      devDependencies: toPackageInfoList(pkg.devDependencies, true),
      ...(pkg.engines ? { engines: pkg.engines } : {}),
      ...(pkg.workspaces ? { workspaces: pkg.workspaces } : {}),
    };
  } catch {
    return {
      name: '', version: '', scripts: {},
      dependencies: [], devDependencies: [],
      error: `Failed to parse ${filePath}`,
    };
  }
}

function toPackageInfoList(
  deps: Record<string, string> | undefined,
  isDev: boolean,
): PackageInfo[] {
  if (!deps) return [];
  return Object.entries(deps).map(([name, version]) => ({ name, version, isDev }));
}
