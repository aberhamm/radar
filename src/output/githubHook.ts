import { execSync } from 'node:child_process';

export interface GhAuthStatus {
  authenticated: boolean;
  repoAccess: boolean;
  error?: string;
}

export interface GhActionResult {
  url?: string;
  error?: string;
}

/**
 * Verify GitHub CLI authentication and repository access.
 * Never throws — returns error details in the result object.
 */
export function checkGhAuth(): GhAuthStatus {
  try {
    execSync('gh auth status', { stdio: 'pipe', encoding: 'utf-8' });
  } catch (err) {
    return {
      authenticated: false,
      repoAccess: false,
      error: `gh auth failed: ${(err as Error).message}`,
    };
  }

  try {
    execSync('gh repo view --json name', { stdio: 'pipe', encoding: 'utf-8' });
  } catch (err) {
    return {
      authenticated: true,
      repoAccess: false,
      error: `gh repo view failed: ${(err as Error).message}`,
    };
  }

  return { authenticated: true, repoAccess: true };
}

/**
 * Create a GitHub issue with the onboarding brief content.
 * Never throws — returns error details in the result object.
 */
export function postOnboardingIssue(repoName: string, briefMarkdown: string): GhActionResult {
  try {
    const title = `Onboarding Brief: ${repoName}`;
    const output = execSync(
      `gh issue create --title "${escapeShellArg(title)}" --body-file -`,
      { input: briefMarkdown, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const url = output.trim();
    return { url: url || undefined };
  } catch (err) {
    return { error: `Failed to create issue: ${(err as Error).message}` };
  }
}

/**
 * Post a PR comment with the scorecard summary (for ci-check goal).
 * Never throws — returns error details in the result object.
 */
export function postCiCheckComment(prNumber: number, scorecardSummary: string): GhActionResult {
  try {
    const output = execSync(
      `gh pr comment ${prNumber} --body-file -`,
      { input: scorecardSummary, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const url = output.trim();
    return { url: url || undefined };
  } catch (err) {
    return { error: `Failed to comment on PR #${prNumber}: ${(err as Error).message}` };
  }
}

/**
 * Escape double quotes and backslashes for shell argument safety.
 */
function escapeShellArg(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
