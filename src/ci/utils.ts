/**
 * Shared CI utilities — API fetch wrapper, token masking, label derivation.
 */

import type { Finding, FindingCategory } from '../types/findings.js';

// ── ciApiFetch ──────────────────────────────────────────────────────────

export interface CiApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Thin wrapper around native fetch() that returns a structured result instead
 * of throwing. Every CI adapter method funnels through this so error handling
 * is consistent.
 */
export async function ciApiFetch<T>(
  url: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<CiApiResponse<T>> {
  const { json, ...fetchOpts } = options;
  if (json !== undefined) {
    fetchOpts.body = JSON.stringify(json);
    fetchOpts.headers = {
      'Content-Type': 'application/json',
      ...fetchOpts.headers,
    };
  }

  try {
    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text || res.statusText };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data };
    }

    // Non-JSON success (e.g. 204 No Content, binary download)
    const text = await res.text();
    return { ok: true, status: res.status, data: text as unknown as T };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

// ── maskToken ───────────────────────────────────────────────────────────

/**
 * Replace all but the last 4 characters with `****`.
 * If the token is 4 chars or fewer, mask the entire thing.
 */
export function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

// ── deriveLabels ────────────────────────────────────────────────────────

const DEFAULT_LABEL_MAP: Record<string, string> = {
  security: 'radar:security-review-needed',
  dependencies: 'radar:deps-outdated',
  configuration: 'radar:config-issue',
};

/**
 * Derive PR labels from finding categories using a configurable map.
 * Only returns labels for categories present in findings with severity >= medium.
 */
export function deriveLabels(
  findings: Finding[],
  labelMap: Record<string, string> = DEFAULT_LABEL_MAP,
): string[] {
  const severityWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };

  const categories = new Set<string>();
  for (const f of findings) {
    if ((severityWeight[f.severity] ?? 0) >= 2) {
      categories.add(f.category);
    }
  }

  const labels: string[] = [];
  for (const cat of categories) {
    if (labelMap[cat]) {
      labels.push(labelMap[cat]);
    }
  }

  return labels.sort();
}

// ── ciLog ───────────────────────────────────────────────────────────────

/**
 * Log to stderr with [radar:ci] prefix for human-readable build logs.
 */
export function ciLog(message: string): void {
  process.stderr.write(`[radar:ci] ${message}\n`);
}
