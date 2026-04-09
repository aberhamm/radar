import { NextResponse } from 'next/server';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/repos — list previously-cloned repos from .repos/.
 */
export async function GET() {
  try {
    const { register } = await import(/* webpackIgnore: true */ 'node:module');
    const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
    try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }

    const clonePath = path.resolve(process.cwd(), '..', 'src', 'tools', 'repo', 'cloneRepo.ts');
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(clonePath).href);
    const listCachedRepos = mod.listCachedRepos as () => Promise<Array<{
      owner: string;
      repo: string;
      localPath: string;
      defaultBranch: string;
      lastCommit: { hash: string; date: string };
    }>>;

    const repos = await listCachedRepos();
    return NextResponse.json({ repos });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list repos: ${(err as Error).message}`, repos: [] },
      { status: 500 },
    );
  }
}
