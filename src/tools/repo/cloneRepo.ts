import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CloneRepoInput, CloneRepoOutput } from '../../types/tools.js';

/**
 * Clone a GitHub repo to a local temp directory.
 * Returns the local path, default branch, and last commit info.
 */
export async function cloneRepo(input: CloneRepoInput): Promise<CloneRepoOutput> {
  const { url, branch } = input;

  // Validate URL looks like a git repo
  if (!url.match(/^https?:\/\/.+\/.+/)) {
    throw new Error(`Invalid repository URL: ${url}`);
  }

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-audit-'));

  try {
    // Build clone command
    const args = ['clone', '--depth', '1'];
    if (branch) {
      args.push('--branch', branch);
    }
    args.push(url, tmpDir);

    execFileSync('git', args, {
      stdio: 'pipe',
      timeout: 300_000, // 5 minute timeout for large repos
    });

    // Get default branch name
    const defaultBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    // Get last commit info
    const commitInfo = execSync('git log -1 --format=%H%n%aI', {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    const [hash, date] = commitInfo.split('\n');

    return {
      localPath: tmpDir,
      defaultBranch,
      lastCommit: { hash, date },
    };
  } catch (err) {
    // Clean up on failure
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    throw new Error(`Failed to clone ${url}: ${(err as Error).message}`);
  }
}
