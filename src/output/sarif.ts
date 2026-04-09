/**
 * SARIF 2.1.0 generator — converts findings to Static Analysis Results
 * Interchange Format for GitHub Code Scanning integration.
 *
 * Severity mapping: critical/high → error, medium → warning, low/info → note.
 * Findings without a filePath are skipped.
 */

import type { Finding, Severity } from '../types/findings.js';

// ── SARIF Types ─────────────────────────────────────────────────────────

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
  fingerprints?: Record<string, string>;
}

type SarifLevel = 'error' | 'warning' | 'note';

// ── Severity → SARIF Level ──────────────────────────────────────────────

function toSarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
    default:
      return 'note';
  }
}

// ── Generator ───────────────────────────────────────────────────────────

export function generateSarif(findings: Finding[], version = '1.0.0'): SarifLog {
  // Only include findings with at least one evidence item with a filePath
  const withFile = findings.filter(
    (f) => f.evidence.length > 0 && f.evidence[0].filePath,
  );

  const rules: SarifRule[] = withFile.map((f) => ({
    id: f.id,
    name: f.title,
    shortDescription: { text: f.description.slice(0, 200) },
    defaultConfiguration: { level: toSarifLevel(f.severity) },
  }));

  const results: SarifResult[] = withFile.map((f) => {
    const ev = f.evidence[0];
    const result: SarifResult = {
      ruleId: f.id,
      level: toSarifLevel(f.severity),
      message: { text: f.description },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: ev.filePath.replace(/\\/g, '/') },
            region: { startLine: ev.lineNumber ?? 1 },
          },
        },
      ],
    };

    if (f.fingerprint) {
      result.fingerprints = { 'radar/v1': f.fingerprint };
    }

    return result;
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Radar',
            version,
            informationUri: 'https://github.com/aberhamm/repo-audit-delivery-agent',
            rules,
          },
        },
        results,
      },
    ],
  };
}
