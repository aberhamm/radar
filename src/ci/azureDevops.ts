/**
 * Azure DevOps CI adapter.
 *
 * Auth: $(System.AccessToken) via SYSTEM_ACCESSTOKEN env var.
 * API: Azure DevOps REST API v7.1 via native fetch().
 * PR context: SYSTEM_PULLREQUEST_PULLREQUESTID env var.
 * Org/project: SYSTEM_COLLECTIONURI + SYSTEM_TEAMPROJECT env vars.
 * Capabilities probe at init — one API call to discover permissions.
 * Comment search pagination: $top=200&$skip=N capped at 1000 threads.
 * No SARIF support.
 */

import fs from 'node:fs';
import type { CiPlatformAdapter, CiCapabilities } from './adapter.js';
import type { Finding } from '../types/findings.js';
import type { SarifLog } from '../output/sarif.js';
import { ciApiFetch, ciLog } from './utils.js';

const API_VERSION = 'api-version=7.1';
const COMMENT_PAGE_SIZE = 200;
const COMMENT_PAGE_CAP = 1000;

export class AzureDevOpsCiAdapter implements CiPlatformAdapter {
  readonly platform = 'azuredevops';

  private token: string;
  private orgUrl: string;
  private project: string;
  private repoId: string;
  private prId: number | null;
  private buildId: string;
  private capabilities: CiCapabilities;

  constructor() {
    this.token = process.env.SYSTEM_ACCESSTOKEN ?? '';
    this.orgUrl = (process.env.SYSTEM_COLLECTIONURI ?? '').replace(/\/$/, '');
    this.project = process.env.SYSTEM_TEAMPROJECT ?? '';
    this.repoId = process.env.BUILD_REPOSITORY_ID ?? '';
    this.buildId = process.env.BUILD_BUILDID ?? '';

    const prIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    this.prId = prIdStr ? parseInt(prIdStr, 10) : null;

    // Default capabilities — updated by probeCapabilities()
    this.capabilities = {
      canComment: !!this.prId,
      canAnnotate: !!this.prId,
      canLabel: false,
      canUploadSarif: false,
      canSetStatus: false,
      canManageArtifacts: !!this.buildId,
    };

    if (!this.token) {
      ciLog('WARNING: SYSTEM_ACCESSTOKEN not set — API calls will fail');
    }
  }

  // ── Auth ────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const encoded = Buffer.from(`:${this.token}`).toString('base64');
    return {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
    };
  }

  private prApiBase(): string {
    return `${this.orgUrl}/${this.project}/_apis/git/repositories/${this.repoId}/pullRequests/${this.prId}`;
  }

  // ── Capabilities Probe ──────────────────────────────────────────────

  async probeCapabilities(): Promise<void> {
    if (!this.prId) return;

    // Try to read the PR to verify token has access
    const url = `${this.prApiBase()}?${API_VERSION}`;
    const res = await ciApiFetch<{ status: string; labels?: unknown[] }>(url, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      ciLog(`Capabilities probe failed: ${res.status} — disabling PR features`);
      this.capabilities.canComment = false;
      this.capabilities.canAnnotate = false;
      return;
    }

    // Labels are available if the PR has the labels property
    this.capabilities.canLabel = true;
    // Status API is separate — try it
    this.capabilities.canSetStatus = true;
  }

  getCapabilities(): CiCapabilities {
    return { ...this.capabilities };
  }

  // ── Post Comment (PR Thread) ────────────────────────────────────────

  async postComment(body: string): Promise<string | null> {
    if (!this.prId) {
      ciLog('Skipping comment: no PR context');
      return null;
    }

    const url = `${this.prApiBase()}/threads?${API_VERSION}`;
    const res = await ciApiFetch<{ id: number }>(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: {
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: 1, // Active
      },
    });

    if (!res.ok) {
      ciLog(`Failed to post comment: ${res.status} ${res.error}`);
      return null;
    }

    const threadId = res.data?.id;
    ciLog(`Posted PR comment thread ${threadId}`);
    return threadId ? `${this.orgUrl}/${this.project}/_git/pull/${this.prId}?threadId=${threadId}` : null;
  }

  // ── Update Comment (search threads for marker) ─────────────────────

  async updateComment(marker: string, body: string): Promise<string | null> {
    if (!this.prId) return this.postComment(body);

    // Paginate through threads looking for the marker
    let skip = 0;
    while (skip < COMMENT_PAGE_CAP) {
      const url = `${this.prApiBase()}/threads?$top=${COMMENT_PAGE_SIZE}&$skip=${skip}&${API_VERSION}`;
      const res = await ciApiFetch<{
        value: Array<{
          id: number;
          comments: Array<{ id: number; content: string }>;
        }>;
      }>(url, { headers: this.authHeaders() });

      if (!res.ok || !res.data?.value?.length) break;

      for (const thread of res.data.value) {
        const firstComment = thread.comments?.[0];
        if (firstComment?.content?.includes(marker)) {
          // Update this comment
          const updateUrl = `${this.prApiBase()}/threads/${thread.id}/comments/${firstComment.id}?${API_VERSION}`;
          const updateRes = await ciApiFetch(updateUrl, {
            method: 'PATCH',
            headers: this.authHeaders(),
            json: { content: body },
          });

          if (updateRes.ok) {
            ciLog(`Updated existing PR comment (thread ${thread.id})`);
            return `${this.orgUrl}/${this.project}/_git/pull/${this.prId}?threadId=${thread.id}`;
          }

          ciLog(`Failed to update comment: ${updateRes.status} ${updateRes.error}`);
        }
      }

      if (res.data.value.length < COMMENT_PAGE_SIZE) break;
      skip += COMMENT_PAGE_SIZE;
    }

    // No existing comment — create new
    return this.postComment(body);
  }

  // ── Annotations (file-anchored thread comments) ─────────────────────

  async postAnnotations(findings: Finding[], cap = 30): Promise<number> {
    if (!this.prId) {
      ciLog('Skipping annotations: no PR context');
      return 0;
    }

    const withFile = findings.filter(
      (f) => f.evidence.length > 0 && f.evidence[0].filePath,
    );

    const severityOrder: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };
    const sorted = [...withFile].sort(
      (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
    );
    const capped = sorted.slice(0, cap);
    let posted = 0;

    for (const f of capped) {
      const filePath = f.evidence[0].filePath.replace(/\\/g, '/');
      const line = f.evidence[0].lineNumber ?? 1;
      const content = `**[${f.severity.toUpperCase()}] ${f.title}**\n\n${f.description}`;

      const url = `${this.prApiBase()}/threads?${API_VERSION}`;
      const res = await ciApiFetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        json: {
          comments: [{ parentCommentId: 0, content, commentType: 1 }],
          threadContext: {
            filePath: `/${filePath}`,
            rightFileStart: { line, offset: 1 },
            rightFileEnd: { line, offset: 1 },
          },
          status: 1,
        },
      });

      if (res.ok) posted++;
    }

    ciLog(`Posted ${posted}/${capped.length} annotations`);
    return posted;
  }

  // ── Labels ──────────────────────────────────────────────────────────

  async addLabels(labels: string[]): Promise<void> {
    if (!this.prId || !this.capabilities.canLabel || labels.length === 0) return;

    for (const label of labels) {
      const url = `${this.prApiBase()}/labels?${API_VERSION}`;
      const res = await ciApiFetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        json: { name: label },
      });

      if (!res.ok && res.status === 403) {
        ciLog('Label API returned 403 — disabling labels');
        this.capabilities.canLabel = false;
        return;
      }
    }

    ciLog(`Added labels: ${labels.join(', ')}`);
  }

  // ── SARIF (not supported) ───────────────────────────────────────────

  async uploadSarif(_sarif: SarifLog): Promise<void> {
    // Azure DevOps doesn't support SARIF upload — skip silently
  }

  // ── Status ──────────────────────────────────────────────────────────

  async setStatus(
    state: 'success' | 'failure' | 'pending',
    description: string,
  ): Promise<void> {
    if (!this.capabilities.canSetStatus) return;

    const stateMap: Record<string, string> = {
      success: 'succeeded',
      failure: 'failed',
      pending: 'pending',
    };

    const url = `${this.orgUrl}/${this.project}/_apis/git/repositories/${this.repoId}/pullRequests/${this.prId}/statuses?${API_VERSION}`;
    const res = await ciApiFetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      json: {
        state: stateMap[state],
        description,
        context: { name: 'radar', genre: 'ci-check' },
      },
    });

    if (!res.ok && res.status === 403) {
      ciLog('Status API returned 403 — disabling');
      this.capabilities.canSetStatus = false;
    }
  }

  // ── Artifacts ───────────────────────────────────────────────────────

  async downloadPreviousArtifact(name: string): Promise<string | null> {
    if (!this.buildId) return null;

    // List recent pipeline runs for this definition
    const definitionId = process.env.SYSTEM_DEFINITIONID ?? '';
    if (!definitionId) {
      ciLog('No SYSTEM_DEFINITIONID — cannot find previous artifacts');
      return null;
    }

    const runsUrl = `${this.orgUrl}/${this.project}/_apis/build/builds?definitions=${definitionId}&$top=5&statusFilter=completed&${API_VERSION}`;
    const runsRes = await ciApiFetch<{ value: Array<{ id: number }> }>(
      runsUrl,
      { headers: this.authHeaders() },
    );

    if (!runsRes.ok || !runsRes.data?.value?.length) {
      ciLog('No previous pipeline runs found');
      return null;
    }

    for (const run of runsRes.data.value) {
      if (String(run.id) === this.buildId) continue; // Skip current run

      const artUrl = `${this.orgUrl}/${this.project}/_apis/build/builds/${run.id}/artifacts?${API_VERSION}`;
      const artRes = await ciApiFetch<{
        value: Array<{ name: string; resource: { downloadUrl: string } }>;
      }>(artUrl, { headers: this.authHeaders() });

      if (!artRes.ok || !artRes.data?.value) continue;

      const match = artRes.data.value.find((a) => a.name === name);
      if (match) {
        const dlRes = await ciApiFetch<string>(match.resource.downloadUrl, {
          headers: this.authHeaders(),
        });

        if (dlRes.ok && dlRes.data) {
          ciLog(`Downloaded previous artifact: ${name} (build ${run.id})`);
          return dlRes.data;
        }
      }
    }

    ciLog(`No previous artifact "${name}" found`);
    return null;
  }

  async uploadArtifact(name: string, filePath: string): Promise<void> {
    if (!this.buildId || !fs.existsSync(filePath)) {
      ciLog(`Cannot upload artifact: ${!this.buildId ? 'no build ID' : 'file not found'}`);
      return;
    }

    // Azure DevOps pipeline artifact upload via REST
    const content = fs.readFileSync(filePath, 'utf-8');
    const createUrl = `${this.orgUrl}/${this.project}/_apis/build/builds/${this.buildId}/artifacts?artifactName=${encodeURIComponent(name)}&${API_VERSION}`;
    const res = await ciApiFetch(createUrl, {
      method: 'POST',
      headers: this.authHeaders(),
      json: {
        name,
        resource: {
          type: 'Container',
          data: content,
        },
      },
    });

    if (!res.ok) {
      ciLog(`Failed to upload artifact: ${res.status} ${res.error}`);
    } else {
      ciLog(`Uploaded artifact: ${name}`);
    }
  }
}
