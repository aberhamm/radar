import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CloneRepoInput, CloneRepoOutput } from '../../types/tools.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Derive a stable directory name from a GitHub URL.
 * e.g. "https://github.com/Sitecore/xmcloud-starter-js" → "Sitecore/xmcloud-starter-js"
 */
function repoDirFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const repo = parts.pop() ?? 'repo';
  const owner = parts.pop() ?? 'unknown';
  return path.join(owner, repo);
}

/** Project-local directory for cloned repos */
export function reposRoot(): string {
  // Walk up from this file (src/tools/repo/) to project root
  return path.resolve(__dirname, '..', '..', '..', '.repos');
}

/**
 * List all previously-cloned repos in .repos/.
 * Returns owner/repo pairs with local path and last commit info.
 */
export async function listCachedRepos(): Promise<Array<{
  owner: string;
  repo: string;
  localPath: string;
  defaultBranch: string;
  lastCommit: { hash: string; date: string };
}>> {
  const root = reposRoot();
  if (!fs.existsSync(root)) return [];

  const results: Array<{
    owner: string;
    repo: string;
    localPath: string;
    defaultBranch: string;
    lastCommit: { hash: string; date: string };
  }> = [];

  const owners = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory());

  const pending: Array<Promise<typeof results[number] | null>> = [];

  for (const ownerDir of owners) {
    const ownerPath = path.join(root, ownerDir.name);
    const repos = fs.readdirSync(ownerPath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const repoDir of repos) {
      const repoPath = path.join(ownerPath, repoDir.name);
      if (!fs.existsSync(path.join(repoPath, '.git'))) continue;

      pending.push(
        (async () => {
          try {
            const [branchRes, commitRes] = await Promise.all([
              execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath }),
              execAsync('git log -1 --format=%H%n%aI', { cwd: repoPath }),
            ]);
            const [hash, date] = commitRes.stdout.trim().split('\n');
            return {
              owner: ownerDir.name,
              repo: repoDir.name,
              localPath: repoPath,
              defaultBranch: branchRes.stdout.trim(),
              lastCommit: { hash, date },
            };
          } catch {
            return null;
          }
        })(),
      );
    }
  }

  const settled = await Promise.all(pending);
  for (const r of settled) { if (r) results.push(r); }

  return results;
}

/**
 * Clone a GitHub repo to `.repos/<owner>/<repo>`.
 * If the repo already exists locally, returns it immediately (no network).
 * Pass `pull: true` to fetch latest before returning.
 * Returns the local path, default branch, and last commit info.
 */
export async function cloneRepo(input: CloneRepoInput): Promise<CloneRepoOutput> {
  const { url, branch, pull } = input;

  // Validate URL looks like a git repo
  if (!url.match(/^https?:\/\/.+\/.+/)) {
    throw new Error(`Invalid repository URL: ${url}`);
  }

  const targetDir = path.join(reposRoot(), repoDirFromUrl(url));

  // Check if we already have this repo
  const cached = fs.existsSync(path.join(targetDir, '.git'));

  if (cached && pull) {
    // Fetch latest from remote
    await execFileAsync('git', ['fetch', '--depth', '1'], {
      cwd: targetDir,
      timeout: 300_000,
    });
    await execFileAsync('git', ['reset', '--hard', 'FETCH_HEAD'], {
      cwd: targetDir,
      timeout: 60_000,
    });
  } else if (!cached) {
    // Fresh clone (async — doesn't block event loop)
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      const args = ['clone', '--depth', '1'];
      if (branch) {
        args.push('--branch', branch);
      }
      args.push(url, targetDir);

      await execFileAsync('git', args, {
        timeout: 300_000, // 5 minute timeout for large repos
      });
    } catch (err) {
      // Clean up on failure
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      throw new Error(`Failed to clone ${url}: ${(err as Error).message}`);
    }
  }

  // Get default branch name
  const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', {
    cwd: targetDir,
  });
  const defaultBranch = branchOut.trim();

  // Get last commit info
  const { stdout: commitOut } = await execAsync('git log -1 --format=%H%n%aI', {
    cwd: targetDir,
  });
  const [hash, date] = commitOut.trim().split('\n');

  return {
    localPath: targetDir,
    defaultBranch,
    lastCommit: { hash, date },
    cached,
  };
}
