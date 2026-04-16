/**
 * GitHub Issue creation from Radar findings.
 *
 * Standalone module — works from dashboard (user-provided token),
 * CLI (--create-issues), or CI (orchestrator). Not coupled to
 * CiPlatformAdapter which is PR-scoped.
 *
 * Dedup: each issue gets a `radar:fp:<12hex>` label. Before creating,
 * we query for open issues with that label. No local state needed.
 */

import type { Finding, Severity } from '../types/findings.js';
import { getFingerprint } from './fingerprintUtils.js';
import { ciApiFetch } from './utils.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface CreateIssuesConfig {
  owner: string;
  repo: string;
  token: string;
  findings: Finding[];
  severityThreshold: Severity;
  apiBase?: string;
  dryRun?: boolean;
}

export interface IssueCreationResult {
  findingId: string;
  fingerprint: string;
  title: string;
  status: 'created' | 'skipped_duplicate' | 'skipped_severity' | 'error';
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
}

export interface CreateIssuesResult {
  results: IssueCreationResult[];
  summary: {
    created: number;
    skippedDuplicate: number;
    skippedSeverity: number;
    errored: number;
  };
}

// ── Severity ordering ──────────────────────────────────────────────────

const SEV_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function severityPassesThreshold(severity: Severity, threshold: Severity): boolean {
  return (SEV_ORDER[severity] ?? 0) >= (SEV_ORDER[threshold] ?? 0);
}

// ── Label helpers ──────────────────────────────────────────────────────

/**
 * Fingerprint label for dedup. First 12 hex chars = 48 bits of entropy,
 * collision-safe for any realistic finding set and well under GitHub's
 * 50-char label name limit.
 */
export function fingerprintLabel(fingerprint: string): string {
  return `radar:fp:${fingerprint.slice(0, 12)}`;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'B60205',
  high: 'D93F0B',
  medium: 'FBCA04',
  low: '0E8A16',
  info: 'C5DEF5',
};

export function issueLabels(finding: Finding): string[] {
  const fp = getFingerprint(finding);
  return [
    'radar:finding',
    `radar:${finding.severity}`,
    `radar:${finding.category}`,
    fingerprintLabel(fp),
  ];
}

// ── Issue rendering ────────────────────────────────────────────────────

export function renderIssueTitle(finding: Finding): string {
  const prefix = `[${finding.severity.toUpperCase()}]`;
  const maxLen = 256 - prefix.length - 1;
  const title = finding.title.length > maxLen
    ? finding.title.slice(0, maxLen - 3) + '...'
    : finding.title;
  return `${prefix} ${title}`;
}

export function renderIssueBody(finding: Finding): string {
  const fp = getFingerprint(finding);
  const lines: string[] = [];

  // Header
  lines.push(`## ${finding.title}`);
  lines.push('');
  const meta: string[] = [
    `**Severity:** \`${finding.severity}\``,
    `**Category:** \`${finding.category}\``,
  ];
  if (finding.confidence != null) {
    meta.push(`**Confidence:** ${finding.confidence}/10`);
  }
  meta.push(`**ID:** \`${finding.id}\``);
  lines.push(meta.join(' | '));
  lines.push('');

  // Description
  lines.push('### Description');
  lines.push('');
  lines.push(finding.description);
  lines.push('');

  // Evidence
  if (finding.evidence.length > 0) {
    lines.push('### Evidence');
    lines.push('');
    for (const ev of finding.evidence) {
      const loc = ev.lineNumber ? `${ev.filePath}:${ev.lineNumber}` : ev.filePath;
      const status = ev.verificationStatus ? ` (${ev.verificationStatus})` : '';
      lines.push(`#### \`${loc}\`${status}`);
      lines.push('');
      if (ev.snippet) {
        lines.push('```');
        lines.push(ev.snippet);
        lines.push('```');
        lines.push('');
      }
      if (ev.description) {
        lines.push(`> ${ev.description}`);
        lines.push('');
      }
    }
  }

  // Tags
  if (finding.tags.length > 0) {
    lines.push('### Tags');
    lines.push('');
    lines.push(finding.tags.map(t => `\`#${t}\``).join(' '));
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`_Created by [Radar](https://github.com/aberhamm/repo-audit-delivery-agent) | Fingerprint: \`${fp}\`_`);

  return lines.join('\n');
}

// ── GitHub API helpers ─────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Ensure a label exists on the repo. 422 = already exists = success.
 */
async function ensureLabel(
  apiBase: string,
  owner: string,
  repo: string,
  token: string,
  name: string,
  color: string,
): Promise<void> {
  const res = await ciApiFetch(
    `${apiBase}/repos/${owner}/${repo}/labels`,
    {
      method: 'POST',
      headers: authHeaders(token),
      json: { name, color },
    },
  );
  // 422 = already exists → fine
  if (!res.ok && res.status !== 422) {
    // Non-critical: label creation failure won't block issue creation
  }
}

/**
 * Create all labels needed for a set of findings.
 */
export async function ensureLabelsExist(
  config: Pick<CreateIssuesConfig, 'owner' | 'repo' | 'token' | 'apiBase'>,
  findings: Finding[],
): Promise<void> {
  const apiBase = config.apiBase ?? 'https://api.github.com';
  const labelSet = new Set<string>();

  // Collect unique labels
  labelSet.add('radar:finding');
  for (const f of findings) {
    for (const label of issueLabels(f)) {
      labelSet.add(label);
    }
  }

  // Create labels (sequential to avoid rate limits, but fast — just metadata)
  for (const label of labelSet) {
    let color = '6B7280'; // default gray
    if (label === 'radar:finding') color = '7C3AED'; // purple
    else if (label.startsWith('radar:fp:')) color = 'EDEDED'; // light gray
    else if (label.startsWith('radar:critical')) color = SEVERITY_COLORS.critical;
    else if (label.startsWith('radar:high')) color = SEVERITY_COLORS.high;
    else if (label.startsWith('radar:medium')) color = SEVERITY_COLORS.medium;
    else if (label.startsWith('radar:low')) color = SEVERITY_COLORS.low;
    else if (label.startsWith('radar:info')) color = SEVERITY_COLORS.info;

    await ensureLabel(apiBase, config.owner, config.repo, config.token, label, color);
  }
}

/**
 * Check if an open issue already exists for a fingerprint label.
 * Returns the issue URL if found, null otherwise.
 */
export async function checkExistingIssue(
  apiBase: string,
  owner: string,
  repo: string,
  token: string,
  fpLabel: string,
): Promise<string | null> {
  const res = await ciApiFetch<Array<{ html_url: string }>>(
    `${apiBase}/repos/${owner}/${repo}/issues?labels=${encodeURIComponent(fpLabel)}&state=open&per_page=1`,
    { headers: authHeaders(token) },
  );
  if (res.ok && res.data && res.data.length > 0) {
    return res.data[0].html_url;
  }
  return null;
}

// ── Main orchestrator ──────────────────────────────────────────────────

export async function createIssuesFromFindings(config: CreateIssuesConfig): Promise<CreateIssuesResult> {
  const apiBase = config.apiBase ?? 'https://api.github.com';
  const results: IssueCreationResult[] = [];
  const summary = { created: 0, skippedDuplicate: 0, skippedSeverity: 0, errored: 0 };

  // Filter by severity threshold first
  const eligible: Finding[] = [];
  for (const f of config.findings) {
    const fp = getFingerprint(f);
    if (!severityPassesThreshold(f.severity, config.severityThreshold)) {
      results.push({ findingId: f.id, fingerprint: fp, title: f.title, status: 'skipped_severity' });
      summary.skippedSeverity++;
    } else {
      eligible.push(f);
    }
  }

  if (eligible.length === 0 || config.dryRun) {
    // For dry run, still check dedup on eligible findings
    if (config.dryRun) {
      for (const f of eligible) {
        const fp = getFingerprint(f);
        const fpLbl = fingerprintLabel(fp);
        const existing = await checkExistingIssue(apiBase, config.owner, config.repo, config.token, fpLbl);
        if (existing) {
          results.push({ findingId: f.id, fingerprint: fp, title: f.title, status: 'skipped_duplicate', issueUrl: existing });
          summary.skippedDuplicate++;
        } else {
          results.push({ findingId: f.id, fingerprint: fp, title: f.title, status: 'created' });
          summary.created++;
        }
      }
    }
    return { results, summary };
  }

  // Ensure all labels exist before creating issues
  await ensureLabelsExist(config, eligible);

  // Create issues sequentially (respect GitHub rate limits)
  for (const f of eligible) {
    const fp = getFingerprint(f);
    const fpLbl = fingerprintLabel(fp);

    try {
      // Dedup check
      const existing = await checkExistingIssue(apiBase, config.owner, config.repo, config.token, fpLbl);
      if (existing) {
        results.push({ findingId: f.id, fingerprint: fp, title: f.title, status: 'skipped_duplicate', issueUrl: existing });
        summary.skippedDuplicate++;
        continue;
      }

      // Create issue
      const res = await ciApiFetch<{ html_url: string; number: number }>(
        `${apiBase}/repos/${config.owner}/${config.repo}/issues`,
        {
          method: 'POST',
          headers: authHeaders(config.token),
          json: {
            title: renderIssueTitle(f),
            body: renderIssueBody(f),
            labels: issueLabels(f),
          },
        },
      );

      if (res.ok && res.data) {
        results.push({
          findingId: f.id,
          fingerprint: fp,
          title: f.title,
          status: 'created',
          issueUrl: res.data.html_url,
          issueNumber: res.data.number,
        });
        summary.created++;
      } else {
        results.push({
          findingId: f.id,
          fingerprint: fp,
          title: f.title,
          status: 'error',
          error: res.error ?? `HTTP ${res.status}`,
        });
        summary.errored++;
      }
    } catch (err) {
      results.push({
        findingId: f.id,
        fingerprint: fp,
        title: f.title,
        status: 'error',
        error: (err as Error).message,
      });
      summary.errored++;
    }
  }

  return { results, summary };
}
