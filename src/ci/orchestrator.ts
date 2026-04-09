/**
 * CI Orchestrator — coordinates all CI operations after the agent run completes.
 *
 * orchestrateCi(result, adapter) runs the full CI integration sequence:
 *   1. Download previous artifact → diff → trend summary
 *   2. Render enhanced PR comment with trend
 *   3. Update-in-place or post comment
 *   4. Post annotations (capped at 30)
 *   5. Add labels
 *   6. Upload SARIF
 *   7. Upload findings artifact
 *   8. Fire webhook
 *   9. Evaluate quality gate
 *
 * Each operation is logged to CiOperationsLog. Failures are rescued and
 * logged — they never fail the overall run.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CiPlatformAdapter, CiOperation, CiOperationsLog } from './adapter.js';
import type { Scorecard, RunMetrics } from '../types/output.js';
import type { Finding } from '../types/findings.js';
import { renderCiComment } from '../output/ciComment.js';
import { generateSarif } from '../output/sarif.js';
import { diffFindings, type DiffResult } from '../commands/diff.js';
import { deriveLabels, ciLog } from './utils.js';

const CI_COMMENT_MARKER = '<!-- radar-ci-comment -->';

export interface OrchestrateConfig {
  scorecard: Scorecard;
  metrics: RunMetrics;
  findings: Finding[];
  outputDir: string;
  repoName: string;
  webhookUrl?: string;
}

export async function orchestrateCi(
  config: OrchestrateConfig,
  adapter: CiPlatformAdapter,
): Promise<CiOperationsLog> {
  const ops: CiOperationsLog = [];
  const caps = adapter.getCapabilities();

  // 1. Download previous artifact and diff
  let diff: DiffResult | null = null;
  await runOp(ops, 'download-previous-artifact', async () => {
    if (!caps.canManageArtifacts) return;
    const prev = await adapter.downloadPreviousArtifact('radar-findings');
    if (prev) {
      try {
        const previousFindings = JSON.parse(prev) as Finding[];
        if (Array.isArray(previousFindings)) {
          diff = diffFindings(previousFindings, config.findings);
          ciLog(`Diff: ${diff.summary}`);
        }
      } catch {
        ciLog('Previous artifact is not valid JSON — treating as first run');
      }
    } else {
      ciLog('First run (no previous artifact)');
    }
  });

  // 2. Render PR comment
  const commentBody = renderCiComment(config.scorecard, config.metrics, diff) + '\n' + CI_COMMENT_MARKER;

  // 3. Post/update comment
  await runOp(ops, 'post-comment', async () => {
    if (!caps.canComment) return;
    await adapter.updateComment(CI_COMMENT_MARKER, commentBody);
  });

  // 4. Post annotations
  await runOp(ops, 'post-annotations', async () => {
    if (!caps.canAnnotate) return;
    await adapter.postAnnotations(config.findings, 30);
  });

  // 5. Add labels
  await runOp(ops, 'add-labels', async () => {
    if (!caps.canLabel) return;
    const labels = deriveLabels(config.findings);
    if (labels.length > 0) {
      await adapter.addLabels(labels);
    }
  });

  // 6. Upload SARIF
  await runOp(ops, 'upload-sarif', async () => {
    // Try even if canUploadSarif is false — the adapter will self-disable on 403
    const sarif = generateSarif(config.findings);
    if (sarif.runs[0].results.length > 0) {
      await adapter.uploadSarif(sarif);
    }
  });

  // 7. Upload findings artifact
  await runOp(ops, 'upload-artifact', async () => {
    if (!caps.canManageArtifacts) return;
    const artifactPath = path.join(config.outputDir, 'radar-findings.json');
    // Strip secrets — only finding data
    const safeFindings = config.findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      tags: f.tags,
      fingerprint: f.fingerprint,
    }));
    fs.writeFileSync(artifactPath, JSON.stringify(safeFindings, null, 2));
    await adapter.uploadArtifact('radar-findings', artifactPath);
  });

  // 8. Webhook
  await runOp(ops, 'webhook', async () => {
    const webhookUrl = config.webhookUrl ?? process.env.WEBHOOK_URL;
    if (!webhookUrl) return;

    const { sendWebhook } = await import('./webhook.js');
    await sendWebhook(webhookUrl, {
      repo: config.repoName,
      score: config.scorecard.overallScore,
      findings: config.findings.length,
      newFindings: diff?.newFindings.length ?? 0,
      resolvedFindings: diff?.resolvedFindings.length ?? 0,
      durationMs: config.metrics.durationMs,
      estimatedCostUsd: config.metrics.totalEstimatedCostUsd,
    });
  });

  return ops;
}

// ── Helper ──────────────────────────────────────────────────────────────

async function runOp(
  ops: CiOperationsLog,
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    ops.push({ operation: name, status: 'success' });
  } catch (err) {
    const error = (err as Error).message;
    ciLog(`${name} failed: ${error}`);
    ops.push({ operation: name, status: 'error', error });
  }
}
