import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Load githubIssues module at runtime, bypassing Turbopack resolution.
 * Follows the same pattern as run/route.ts for @agent/ imports.
 */
async function loadGithubIssues() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');

  // Prefer compiled JS from dist/
  const distPath = path.resolve(process.cwd(), '..', 'dist', 'ci', 'githubIssues.js');
  if (fs.existsSync(distPath)) {
    return await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
  }

  // Fallback: tsx loader for development without a build step
  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }

  const srcPath = path.resolve(process.cwd(), '..', 'src', 'ci', 'githubIssues.ts');
  return await import(/* webpackIgnore: true */ pathToFileURL(srcPath).href);
}

/**
 * POST /api/create-issues
 *
 * Creates GitHub Issues from findings. Used by the dashboard's
 * "Create Issues" button. Accepts findings + GitHub repo info,
 * returns creation results with issue URLs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { owner, repo, findings, severityThreshold, dryRun } = body as {
      owner?: string;
      repo?: string;
      findings?: unknown[];
      severityThreshold?: string;
      dryRun?: boolean;
    };

    const token = process.env.GITHUB_TOKEN ?? '';

    if (!token) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN environment variable is not set' },
        { status: 400 },
      );
    }

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'owner and repo are required' },
        { status: 400 },
      );
    }

    if (!findings || !Array.isArray(findings) || findings.length === 0) {
      return NextResponse.json(
        { error: 'findings array is required and must not be empty' },
        { status: 400 },
      );
    }

    const { createIssuesFromFindings } = await loadGithubIssues();

    const config = {
      owner,
      repo,
      token,
      findings,
      severityThreshold: severityThreshold ?? 'medium',
      dryRun: dryRun ?? false,
    };

    const result = await createIssuesFromFindings(config);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[create-issues] Failed:', err);
    return NextResponse.json(
      { error: 'Issue creation failed' },
      { status: 500 },
    );
  }
}
