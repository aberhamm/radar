/**
 * Shared fingerprint utilities for cross-run finding identity.
 *
 * SHA-256 of `category:firstFilePath:normalizedTitle` — stable across runs
 * even if description or severity changes.
 */

import { createHash } from 'node:crypto';
import type { Finding, Evidence } from '../types/findings.js';

/**
 * Compute a stable SHA-256 fingerprint from raw components.
 */
export function computeFingerprint(category: string, title: string, evidence: Evidence[]): string {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ').trim();
  const firstFile = evidence.length > 0 ? evidence[0].filePath.replace(/\\/g, '/') : '';
  const input = `${category}:${firstFile}:${normalizedTitle}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Get a finding's fingerprint — uses the stored `.fingerprint` field when
 * present, otherwise computes it on the fly (for older data).
 */
export function getFingerprint(f: Finding): string {
  return f.fingerprint || computeFingerprint(f.category, f.title, f.evidence);
}
