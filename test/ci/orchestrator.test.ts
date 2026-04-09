import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { orchestrateCi } from '../../src/ci/orchestrator.js';
import type { CiPlatformAdapter, CiCapabilities } from '../../src/ci/adapter.js';
import type { Scorecard, RunMetrics } from '../../src/types/output.js';
import type { Finding } from '../../src/types/findings.js';

function makeMockAdapter(capOverrides: Partial<CiCapabilities> = {}): CiPlatformAdapter {
  const caps: CiCapabilities = {
    canComment: true,
    canAnnotate: true,
    canLabel: true,
    canUploadSarif: false,
    canSetStatus: true,
    canManageArtifacts: true,
    ...capOverrides,
  };

  return {
    platform: 'github',
    getCapabilities: () => caps,
    postComment: vi.fn().mockResolvedValue('https://github.com/test/1'),
    updateComment: vi.fn().mockResolvedValue('https://github.com/test/1'),
    postAnnotations: vi.fn().mockResolvedValue(2),
    addLabels: vi.fn().mockResolvedValue(undefined),
    uploadSarif: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    downloadPreviousArtifact: vi.fn().mockResolvedValue(null),
    uploadArtifact: vi.fn().mockResolvedValue(undefined),
  };
}

function makeScorecard(): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'ci-check',
    generatedAt: new Date().toISOString(),
    overallScore: 'green',
    categories: [
      { category: 'security', score: 'green', findings: [], summary: 'ok' },
    ],
    topRisks: [],
  };
}

function makeMetrics(): RunMetrics {
  return {
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 5000,
    toolCalls: 10,
    models: {},
    totalEstimatedCostUsd: 0.05,
  };
}

function makeFinding(id = 'F-001'): Finding {
  return {
    id,
    category: 'security',
    severity: 'high',
    title: 'Test finding',
    description: 'A test finding',
    evidence: [{ filePath: 'src/test.ts', lineNumber: 1, snippet: 'test', description: 'test' }],
    tags: ['test'],
    fingerprint: 'abc123',
  };
}

describe('orchestrateCi', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all operations and returns success log', async () => {
    const adapter = makeMockAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
    const ops = await orchestrateCi(
      {
        scorecard: makeScorecard(),
        metrics: makeMetrics(),
        findings: [makeFinding()],
        outputDir: tmpDir,
        repoName: 'test-repo',
      },
      adapter,
    );

    expect(ops.length).toBeGreaterThan(0);
    const errorOps = ops.filter((op) => op.status === 'error');
    expect(errorOps).toEqual([]);
    expect(adapter.updateComment).toHaveBeenCalled();
    expect(adapter.postAnnotations).toHaveBeenCalled();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips comment when canComment is false', async () => {
    const adapter = makeMockAdapter({ canComment: false });
    const ops = await orchestrateCi(
      {
        scorecard: makeScorecard(),
        metrics: makeMetrics(),
        findings: [],
        outputDir: '/tmp/test',
        repoName: 'test-repo',
      },
      adapter,
    );

    // Comment operation should succeed (it checks caps internally)
    expect(adapter.updateComment).not.toHaveBeenCalled();
  });

  it('handles partial failures gracefully', async () => {
    const adapter = makeMockAdapter();
    (adapter.postAnnotations as any).mockRejectedValue(new Error('Annotations API down'));

    const ops = await orchestrateCi(
      {
        scorecard: makeScorecard(),
        metrics: makeMetrics(),
        findings: [makeFinding()],
        outputDir: '/tmp/test',
        repoName: 'test-repo',
      },
      adapter,
    );

    const annotationOp = ops.find((op) => op.operation === 'post-annotations');
    expect(annotationOp?.status).toBe('error');
    expect(annotationOp?.error).toContain('Annotations API down');

    // Other operations should still succeed
    const commentOp = ops.find((op) => op.operation === 'post-comment');
    expect(commentOp?.status).toBe('success');
  });

  it('diffs when previous artifact is available', async () => {
    const previousFindings = [makeFinding('F-OLD')];
    const adapter = makeMockAdapter();
    (adapter.downloadPreviousArtifact as any).mockResolvedValue(
      JSON.stringify(previousFindings),
    );

    const ops = await orchestrateCi(
      {
        scorecard: makeScorecard(),
        metrics: makeMetrics(),
        findings: [makeFinding('F-NEW')],
        outputDir: '/tmp/test',
        repoName: 'test-repo',
      },
      adapter,
    );

    const dlOp = ops.find((op) => op.operation === 'download-previous-artifact');
    expect(dlOp?.status).toBe('success');
  });

  it('handles corrupt previous artifact JSON', async () => {
    const adapter = makeMockAdapter();
    (adapter.downloadPreviousArtifact as any).mockResolvedValue('not valid json{{{');

    const ops = await orchestrateCi(
      {
        scorecard: makeScorecard(),
        metrics: makeMetrics(),
        findings: [],
        outputDir: '/tmp/test',
        repoName: 'test-repo',
      },
      adapter,
    );

    // Should not crash — treated as first run
    const dlOp = ops.find((op) => op.operation === 'download-previous-artifact');
    expect(dlOp?.status).toBe('success');
  });
});
