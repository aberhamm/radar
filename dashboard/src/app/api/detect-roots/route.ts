import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/detect-roots — detect app roots in a repo for monorepo selection.
 * Returns the list of roots so the UI can prompt the user to pick one.
 */
export async function POST(req: NextRequest) {
  let body: { repoPath?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { repoPath } = body;
  if (!repoPath) {
    return NextResponse.json({ error: 'repoPath is required' }, { status: 400 });
  }

  try {
    const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
    const fs = await import(/* webpackIgnore: true */ 'node:fs');

    // Prefer compiled JS
    const distPath = path.resolve(process.cwd(), '..', 'dist', 'tools', 'analysis', 'detectAppRoots.js');
    let detectAppRoots: (repoRoot: string, input: Record<string, unknown>) => Promise<{
      roots: Array<{ path: string; type: string; hasPackageJson: boolean; framework?: string; frameworkVersion?: string; plugins?: string[] }>;
      isMonorepo: boolean;
      monorepoTool?: string;
    }>;

    if (fs.existsSync(distPath)) {
      const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
      detectAppRoots = mod.detectAppRoots;
    } else {
      const { register } = await import(/* webpackIgnore: true */ 'node:module');
      try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }

      const srcPath = path.resolve(process.cwd(), '..', 'src', 'tools', 'analysis', 'detectAppRoots.ts');
      const mod = await import(/* webpackIgnore: true */ pathToFileURL(srcPath).href);
      detectAppRoots = mod.detectAppRoots;
    }

    const result = await detectAppRoots(repoPath, {});

    return NextResponse.json({
      roots: result.roots,
      isMonorepo: result.isMonorepo,
      monorepoTool: result.monorepoTool,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
