import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/clone — clone or pull a GitHub repo to .repos/<owner>/<repo>.
 * Always fetches latest from remote (pull: true).
 * Returns the local path so the frontend can pass it to /api/run.
 */
export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url } = body;
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
    return NextResponse.json({ error: 'A valid HTTP(S) URL is required' }, { status: 400 });
  }

  try {
    // Load cloneRepo via tsx (same pattern as /api/run)
    const { register } = await import(/* webpackIgnore: true */ 'node:module');
    const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
    try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }

    const clonePath = path.resolve(process.cwd(), '..', 'src', 'tools', 'repo', 'cloneRepo.ts');
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(clonePath).href);
    const cloneRepo = mod.cloneRepo as (input: { url: string; pull?: boolean }) => Promise<{
      localPath: string;
      defaultBranch: string;
      lastCommit: { hash: string; date: string };
      cached: boolean;
    }>;

    const result = await cloneRepo({ url, pull: true });
    const urlPath = url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const urlParts = urlPath.split('/');
    const repoName = urlParts.length >= 2 ? `${urlParts[0]}/${urlParts[1]}` : urlParts[0] ?? path.basename(result.localPath);

    return NextResponse.json({
      ok: true,
      localPath: result.localPath,
      repoName,
      defaultBranch: result.defaultBranch,
      lastCommit: result.lastCommit,
      cached: result.cached,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Clone failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
