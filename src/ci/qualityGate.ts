/**
 * Quality gate evaluator — configurable fail/warn thresholds.
 *
 * Exit code semantics:
 *   0 = pass (or warn)
 *   1 = fail (quality gate triggered)
 *   2 = reserved for agent errors (not handled here)
 *
 * Replaces the hardcoded `red=1` logic in analyze.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scorecard, ScoreLevel } from '../types/output.js';
import type { DiffResult } from '../commands/diff.js';
import { ciLog } from './utils.js';

export interface QualityGateConfig {
  failOn: {
    overallScore?: ScoreLevel;
    newCriticalFindings?: boolean;
    newHighFindings?: boolean;
  };
  warnOn: {
    overallScore?: ScoreLevel;
    newHighFindings?: boolean;
    regressionCount?: number;
  };
}

export interface QualityGateResult {
  exitCode: 0 | 1;
  status: 'pass' | 'warn' | 'fail';
  reasons: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'quality-gates.json');

export function loadQualityGateConfig(configPath?: string): QualityGateConfig {
  const filePath = configPath ?? DEFAULT_CONFIG_PATH;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as QualityGateConfig;
  } catch {
    ciLog(`Quality gate config not found at ${filePath} — using defaults`);
    return {
      failOn: { overallScore: 'red', newCriticalFindings: true, newHighFindings: false },
      warnOn: { overallScore: 'yellow', newHighFindings: true, regressionCount: 3 },
    };
  }
}

export function evaluateQualityGate(
  scorecard: Scorecard,
  diff: DiffResult | null,
  config: QualityGateConfig,
): QualityGateResult {
  const failReasons: string[] = [];
  const warnReasons: string[] = [];

  // ── Fail conditions ───────────────────────────────────────────────
  if (config.failOn.overallScore && scorecard.overallScore === config.failOn.overallScore) {
    failReasons.push(`Overall score is ${scorecard.overallScore}`);
  }

  if (config.failOn.newCriticalFindings && diff) {
    const criticals = diff.newFindings.filter((f) => f.severity === 'critical');
    if (criticals.length > 0) {
      failReasons.push(`${criticals.length} new critical finding(s)`);
    }
  }

  if (config.failOn.newHighFindings && diff) {
    const highs = diff.newFindings.filter((f) => f.severity === 'high');
    if (highs.length > 0) {
      failReasons.push(`${highs.length} new high finding(s)`);
    }
  }

  if (failReasons.length > 0) {
    return { exitCode: 1, status: 'fail', reasons: failReasons };
  }

  // ── Warn conditions ───────────────────────────────────────────────
  if (config.warnOn.overallScore && scorecard.overallScore === config.warnOn.overallScore) {
    warnReasons.push(`Overall score is ${scorecard.overallScore}`);
  }

  if (config.warnOn.newHighFindings && diff) {
    const highs = diff.newFindings.filter((f) => f.severity === 'high');
    if (highs.length > 0) {
      warnReasons.push(`${highs.length} new high finding(s)`);
    }
  }

  if (config.warnOn.regressionCount && diff) {
    if (diff.newFindings.length >= config.warnOn.regressionCount) {
      warnReasons.push(`${diff.newFindings.length} new findings (threshold: ${config.warnOn.regressionCount})`);
    }
  }

  if (warnReasons.length > 0) {
    return { exitCode: 0, status: 'warn', reasons: warnReasons };
  }

  return { exitCode: 0, status: 'pass', reasons: [] };
}
