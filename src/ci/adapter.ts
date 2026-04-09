/**
 * CI Platform Adapter — interface, factory, and generic fallback.
 *
 * The factory reads environment variables to detect the running CI platform
 * and returns the appropriate adapter. When no CI platform is detected,
 * GenericAdapter is returned (exit code + stdout only).
 */

import type { Finding } from '../types/findings.js';
import type { SarifLog } from '../output/sarif.js';

// ── Capabilities ────────────────────────────────────────────────────────

export interface CiCapabilities {
  canComment: boolean;
  canAnnotate: boolean;
  canLabel: boolean;
  canUploadSarif: boolean;
  canSetStatus: boolean;
  canManageArtifacts: boolean;
}

// ── CiOperationLog ──────────────────────────────────────────────────────

export interface CiOperation {
  operation: string;
  status: 'success' | 'skipped' | 'error';
  error?: string;
}

export type CiOperationsLog = CiOperation[];

// ── Interface ───────────────────────────────────────────────────────────

export interface CiPlatformAdapter {
  readonly platform: string;

  /** Post a new comment on the PR/MR. Returns comment URL or null. */
  postComment(body: string): Promise<string | null>;

  /** Find an existing comment with `marker` and update it, or post new. Returns URL or null. */
  updateComment(marker: string, body: string): Promise<string | null>;

  /** Post file-level annotations (check run annotations or PR thread comments). Returns count posted. */
  postAnnotations(findings: Finding[], cap?: number): Promise<number>;

  /** Add labels to the PR/MR. */
  addLabels(labels: string[]): Promise<void>;

  /** Upload SARIF for code scanning. */
  uploadSarif(sarif: SarifLog): Promise<void>;

  /** Set commit/PR status (success/failure/pending). */
  setStatus(state: 'success' | 'failure' | 'pending', description: string): Promise<void>;

  /** Download the previous run's artifact by name. Returns JSON string or null if not found. */
  downloadPreviousArtifact(name: string): Promise<string | null>;

  /** Upload an artifact for the current run. */
  uploadArtifact(name: string, filePath: string): Promise<void>;

  /** Get platform capabilities. */
  getCapabilities(): CiCapabilities;
}

// ── GenericAdapter (no-op fallback) ─────────────────────────────────────

export class GenericAdapter implements CiPlatformAdapter {
  readonly platform = 'generic';

  getCapabilities(): CiCapabilities {
    return {
      canComment: false,
      canAnnotate: false,
      canLabel: false,
      canUploadSarif: false,
      canSetStatus: false,
      canManageArtifacts: false,
    };
  }

  async postComment(): Promise<null> { return null; }
  async updateComment(): Promise<null> { return null; }
  async postAnnotations(): Promise<number> { return 0; }
  async addLabels(): Promise<void> {}
  async uploadSarif(): Promise<void> {}
  async setStatus(): Promise<void> {}
  async downloadPreviousArtifact(): Promise<null> { return null; }
  async uploadArtifact(): Promise<void> {}
}

// ── Factory ─────────────────────────────────────────────────────────────

/**
 * Detect the running CI platform from environment variables and return
 * the appropriate adapter. Returns GenericAdapter when no CI is detected.
 */
export async function detectCiPlatform(): Promise<CiPlatformAdapter> {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const { GitHubCiAdapter } = await import('./github.js');
    return new GitHubCiAdapter();
  }

  if (process.env.TF_BUILD === 'True') {
    const { AzureDevOpsCiAdapter } = await import('./azureDevops.js');
    const adapter = new AzureDevOpsCiAdapter();
    await adapter.probeCapabilities();
    return adapter;
  }

  return new GenericAdapter();
}
