/**
 * GitHub Actions CI adapter.
 *
 * Auth: GITHUB_TOKEN env var (provided by Actions).
 * API: GitHub REST API v3 via native fetch().
 * PR context: parsed from $GITHUB_EVENT_PATH (pull_request event payload).
 * Artifacts: REST API (no @actions/artifact dependency).
 * SARIF: canUploadSarif defaults false, tries once, disables on 403.
 */

import fs from 'node:fs';
import type { CiPlatformAdapter, CiCapabilities } from './adapter.js';
import type { Finding } from '../types/findings.js';
import type { SarifLog } from '../output/sarif.js';
import { ciApiFetch, maskToken, ciLog } from './utils.js';

interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  sha: string;
}

export class GitHubCiAdapter implements CiPlatformAdapter {
  readonly platform = 'github';

  private token: string;
  private apiBase: string;
  private pr: PrContext | null;
  private canUploadSarif = false;

  constructor() {
    this.token = process.env.GITHUB_TOKEN ?? '';
    this.apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
    this.pr = this.parsePrContext();

    if (!this.token) {
      ciLog('WARNING: GITHUB_TOKEN not set — API calls will fail');
    }
  }

  // ── PR Context ──────────────────────────────────────────────────────

  private parsePrContext(): PrContext | null {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) return null;

    try {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
      const pr = event.pull_request;
      if (!pr) return null;

      const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
      if (!owner || !repo) return null;

      return {
        owner,
        repo,
        prNumber: pr.number,
        sha: pr.head?.sha ?? process.env.GITHUB_SHA ?? '',
      };
    } catch {
      ciLog('WARNING: Failed to parse GITHUB_EVENT_PATH');
      return null;
    }
  }

  // ── Auth headers ────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // ── Capabilities ────────────────────────────────────────────────────

  getCapabilities(): CiCapabilities {
    return {
      canComment: !!this.pr,
      canAnnotate: !!this.pr,
      canLabel: !!this.pr,
      canUploadSarif: this.canUploadSarif,
      canSetStatus: !!this.pr,
      canManageArtifacts: true,
    };
  }

  // ── Post Comment ────────────────────────────────────────────────────

  async postComment(body: string): Promise<string | null> {
    if (!this.pr) {
      ciLog('Skipping comment: no PR context');
      return null;
    }

    const url = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/issues/${this.pr.prNumber}/comments`;
    const res = await ciApiFetch<{ html_url: string }>(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: { body },
    });

    if (!res.ok) {
      ciLog(`Failed to post comment: ${res.status} ${res.error}`);
      return null;
    }

    return res.data?.html_url ?? null;
  }

  // ── Update Comment (find-by-marker or create) ──────────────────────

  async updateComment(marker: string, body: string): Promise<string | null> {
    if (!this.pr) return this.postComment(body);

    // Search existing comments for the marker
    const listUrl = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/issues/${this.pr.prNumber}/comments?per_page=100`;
    const listRes = await ciApiFetch<Array<{ id: number; body: string; html_url: string }>>(
      listUrl,
      { headers: this.authHeaders() },
    );

    if (listRes.ok && listRes.data) {
      const existing = listRes.data.find((c) => c.body.includes(marker));
      if (existing) {
        const updateUrl = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/issues/comments/${existing.id}`;
        const updateRes = await ciApiFetch<{ html_url: string }>(updateUrl, {
          method: 'PATCH',
          headers: this.authHeaders(),
          json: { body },
        });

        if (updateRes.ok) {
          ciLog('Updated existing PR comment');
          return updateRes.data?.html_url ?? existing.html_url;
        }

        ciLog(`Failed to update comment: ${updateRes.status} ${updateRes.error}`);
      }
    }

    // No existing comment found — create new
    return this.postComment(body);
  }

  // ── Annotations (Check Run) ─────────────────────────────────────────

  async postAnnotations(findings: Finding[], cap = 30): Promise<number> {
    if (!this.pr) {
      ciLog('Skipping annotations: no PR context');
      return 0;
    }

    const withFile = findings.filter(
      (f) => f.evidence.length > 0 && f.evidence[0].filePath,
    );

    // Sort by severity (critical first), then cap
    const severityOrder: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };
    const sorted = [...withFile].sort(
      (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
    );
    const capped = sorted.slice(0, cap);

    if (capped.length === 0) return 0;

    const annotations = capped.map((f) => ({
      path: f.evidence[0].filePath.replace(/\\/g, '/'),
      start_line: f.evidence[0].lineNumber ?? 1,
      end_line: f.evidence[0].lineNumber ?? 1,
      annotation_level: f.severity === 'critical' || f.severity === 'high'
        ? 'failure' as const
        : f.severity === 'medium'
          ? 'warning' as const
          : 'notice' as const,
      title: `[${f.severity.toUpperCase()}] ${f.title}`,
      message: f.description,
    }));

    const url = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/check-runs`;
    const hasFailure = annotations.some((a) => a.annotation_level === 'failure');
    const res = await ciApiFetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: {
        name: 'Radar CI',
        head_sha: this.pr.sha,
        status: 'completed',
        conclusion: hasFailure ? 'failure' : 'neutral',
        output: {
          title: `Radar: ${capped.length} finding(s)`,
          summary: `${capped.length} findings annotated (${withFile.length} total with file paths, capped at ${cap})`,
          annotations,
        },
      },
    });

    if (!res.ok) {
      ciLog(`Failed to post annotations: ${res.status} ${res.error}`);
      return 0;
    }

    ciLog(`Posted ${capped.length} annotations`);
    return capped.length;
  }

  // ── Labels ──────────────────────────────────────────────────────────

  async addLabels(labels: string[]): Promise<void> {
    if (!this.pr || labels.length === 0) return;

    const url = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/issues/${this.pr.prNumber}/labels`;
    const res = await ciApiFetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: { labels },
    });

    if (!res.ok) {
      ciLog(`Failed to add labels: ${res.status} ${res.error}`);
    } else {
      ciLog(`Added labels: ${labels.join(', ')}`);
    }
  }

  // ── SARIF Upload ────────────────────────────────────────────────────

  async uploadSarif(sarif: SarifLog): Promise<void> {
    if (!this.pr) return;

    // Try once — disable on 403 (no GitHub Advanced Security)
    const url = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/code-scanning/sarifs`;
    const sarifContent = Buffer.from(JSON.stringify(sarif)).toString('base64');
    const res = await ciApiFetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: {
        commit_sha: this.pr.sha,
        ref: `refs/pull/${this.pr.prNumber}/head`,
        sarif: sarifContent,
      },
    });

    if (res.status === 403) {
      ciLog('SARIF upload failed (403) — GitHub Advanced Security likely not enabled. Disabling.');
      this.canUploadSarif = false;
      return;
    }

    if (!res.ok) {
      ciLog(`SARIF upload failed: ${res.status} ${res.error}`);
      return;
    }

    this.canUploadSarif = true;
    ciLog('SARIF uploaded successfully');
  }

  // ── Status ──────────────────────────────────────────────────────────

  async setStatus(
    state: 'success' | 'failure' | 'pending',
    description: string,
  ): Promise<void> {
    if (!this.pr) return;

    const url = `${this.apiBase}/repos/${this.pr.owner}/${this.pr.repo}/statuses/${this.pr.sha}`;
    const res = await ciApiFetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: { state, description, context: 'radar/ci-check' },
    });

    if (!res.ok) {
      ciLog(`Failed to set status: ${res.status} ${res.error}`);
    }
  }

  // ── Artifacts ───────────────────────────────────────────────────────

  async downloadPreviousArtifact(name: string): Promise<string | null> {
    if (!this.pr) return null;

    const repo = `${this.pr.owner}/${this.pr.repo}`;
    const branch = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? '';

    // List recent workflow runs for this branch
    const runsUrl = `${this.apiBase}/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5&status=completed`;
    const runsRes = await ciApiFetch<{ workflow_runs: Array<{ id: number }> }>(
      runsUrl,
      { headers: this.authHeaders() },
    );

    if (!runsRes.ok || !runsRes.data?.workflow_runs?.length) {
      ciLog('No previous workflow runs found for artifact lookup');
      return null;
    }

    // Search for the named artifact across recent runs
    for (const run of runsRes.data.workflow_runs) {
      const artifactsUrl = `${this.apiBase}/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=10`;
      const artRes = await ciApiFetch<{
        artifacts: Array<{ id: number; name: string; archive_download_url: string }>;
      }>(artifactsUrl, { headers: this.authHeaders() });

      if (!artRes.ok || !artRes.data?.artifacts) continue;

      const match = artRes.data.artifacts.find((a) => a.name === name);
      if (match) {
        // Download the artifact zip
        const dlUrl = `${this.apiBase}/repos/${repo}/actions/artifacts/${match.id}/zip`;
        const dlRes = await ciApiFetch<string>(dlUrl, {
          headers: this.authHeaders(),
        });

        if (dlRes.ok && dlRes.data) {
          ciLog(`Downloaded previous artifact: ${name} (run ${run.id})`);
          return dlRes.data;
        }
      }
    }

    ciLog(`No previous artifact "${name}" found`);
    return null;
  }

  async uploadArtifact(name: string, filePath: string): Promise<void> {
    // GitHub Actions artifact upload requires the @actions/artifact package
    // or multi-step REST API calls with retention. For now, use GITHUB_OUTPUT
    // to signal the artifact path for a subsequent upload step.
    if (!fs.existsSync(filePath)) {
      ciLog(`Artifact file not found: ${filePath}`);
      return;
    }

    // Write artifact path to GITHUB_OUTPUT for the action wrapper to pick up
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      fs.appendFileSync(outputFile, `artifact-name=${name}\n`);
      fs.appendFileSync(outputFile, `artifact-path=${filePath}\n`);
      ciLog(`Artifact registered for upload: ${name} → ${filePath}`);
    } else {
      ciLog(`Artifact ready at ${filePath} (no GITHUB_OUTPUT to register)`);
    }
  }
}
