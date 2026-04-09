import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitHubCiAdapter } from '../../src/ci/github.js';
import type { Finding } from '../../src/types/findings.js';

function mockFetch(responses: Array<{ ok: boolean; status: number; data?: unknown; text?: string }>) {
  let callIndex = 0;
  globalThis.fetch = vi.fn().mockImplementation(() => {
    const r = responses[callIndex++] ?? { ok: false, status: 500, text: 'no more mocked responses' };
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      statusText: r.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(r.data),
      text: () => Promise.resolve(r.text ?? JSON.stringify(r.data)),
    });
  });
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: 'high',
    title: 'Exposed API Key',
    description: 'API key found in source',
    evidence: [{ filePath: 'src/config.ts', lineNumber: 42, snippet: 'key=abc', description: 'API key' }],
    tags: ['security'],
    ...overrides,
  };
}

describe('GitHubCiAdapter', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let tmpEventFile: string;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_testtoken1234567890';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_API_URL = 'https://api.github.com';

    // Write a temp event file for PR context
    const eventPayload = {
      pull_request: { number: 42, head: { sha: 'abc123' } },
    };
    tmpEventFile = path.join(os.tmpdir(), 'gh-event-test.json');
    fs.writeFileSync(tmpEventFile, JSON.stringify(eventPayload));
    process.env.GITHUB_EVENT_PATH = tmpEventFile;

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpEventFile); } catch {}
  });

  it('detects PR context from GITHUB_EVENT_PATH', () => {
    const adapter = new GitHubCiAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.canComment).toBe(true);
    expect(caps.canAnnotate).toBe(true);
    expect(caps.canLabel).toBe(true);
  });

  it('returns canComment=false when no PR context', () => {
    delete process.env.GITHUB_EVENT_PATH;
    const adapter = new GitHubCiAdapter();
    expect(adapter.getCapabilities().canComment).toBe(false);
  });

  it('postComment sends POST and returns URL', async () => {
    mockFetch([
      { ok: true, status: 201, data: { html_url: 'https://github.com/owner/repo/pull/42#comment-1' } },
    ]);

    const adapter = new GitHubCiAdapter();
    const url = await adapter.postComment('Test comment');
    expect(url).toBe('https://github.com/owner/repo/pull/42#comment-1');

    const [callUrl, callOpts] = (globalThis.fetch as any).mock.calls[0];
    expect(callUrl).toContain('/issues/42/comments');
    expect(callOpts.method).toBe('POST');
  });

  it('postComment returns null on 403', async () => {
    mockFetch([{ ok: false, status: 403, text: 'Resource not accessible' }]);

    const adapter = new GitHubCiAdapter();
    const url = await adapter.postComment('Test');
    expect(url).toBeNull();
  });

  it('updateComment finds existing and patches', async () => {
    mockFetch([
      // List comments
      { ok: true, status: 200, data: [
        { id: 100, body: 'other comment', html_url: 'url1' },
        { id: 200, body: 'has <!-- radar-ci-comment --> marker', html_url: 'url2' },
      ]},
      // Patch comment
      { ok: true, status: 200, data: { html_url: 'https://github.com/owner/repo/pull/42#comment-200' } },
    ]);

    const adapter = new GitHubCiAdapter();
    const url = await adapter.updateComment('<!-- radar-ci-comment -->', 'Updated body');
    expect(url).toBe('https://github.com/owner/repo/pull/42#comment-200');
  });

  it('updateComment falls back to postComment when no marker found', async () => {
    mockFetch([
      // List comments — none with marker
      { ok: true, status: 200, data: [
        { id: 100, body: 'other comment', html_url: 'url1' },
      ]},
      // Post new comment
      { ok: true, status: 201, data: { html_url: 'https://github.com/owner/repo/pull/42#new' } },
    ]);

    const adapter = new GitHubCiAdapter();
    const url = await adapter.updateComment('<!-- radar-ci-comment -->', 'New body');
    expect(url).toBe('https://github.com/owner/repo/pull/42#new');
  });

  it('postAnnotations creates check run with annotations', async () => {
    mockFetch([
      { ok: true, status: 201, data: { id: 1 } },
    ]);

    const adapter = new GitHubCiAdapter();
    const findings = [makeFinding(), makeFinding({ id: 'F-002', severity: 'medium' })];
    const count = await adapter.postAnnotations(findings);
    expect(count).toBe(2);

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.output.annotations).toHaveLength(2);
    expect(body.output.annotations[0].annotation_level).toBe('failure');
    expect(body.output.annotations[1].annotation_level).toBe('warning');
  });

  it('postAnnotations caps at specified limit', async () => {
    mockFetch([{ ok: true, status: 201, data: { id: 1 } }]);

    const adapter = new GitHubCiAdapter();
    const findings = Array.from({ length: 50 }, (_, i) =>
      makeFinding({ id: `F-${i}`, severity: 'medium' })
    );
    const count = await adapter.postAnnotations(findings, 10);
    expect(count).toBe(10);
  });

  it('postAnnotations skips findings without filePath', async () => {
    mockFetch([{ ok: true, status: 201, data: { id: 1 } }]);

    const adapter = new GitHubCiAdapter();
    const findings = [
      makeFinding(),
      makeFinding({ id: 'F-002', evidence: [] }), // No evidence
    ];
    const count = await adapter.postAnnotations(findings);
    expect(count).toBe(1);
  });

  it('addLabels sends POST with labels', async () => {
    mockFetch([{ ok: true, status: 200, data: [] }]);

    const adapter = new GitHubCiAdapter();
    await adapter.addLabels(['radar:security-review-needed']);

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.labels).toEqual(['radar:security-review-needed']);
  });

  it('uploadSarif disables on 403', async () => {
    mockFetch([{ ok: false, status: 403, text: 'Advanced Security not enabled' }]);

    const adapter = new GitHubCiAdapter();
    await adapter.uploadSarif({
      $schema: 'test',
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'Radar', version: '1.0', informationUri: '', rules: [] } }, results: [] }],
    });

    expect(adapter.getCapabilities().canUploadSarif).toBe(false);
  });

  it('downloadPreviousArtifact returns null when no runs found', async () => {
    process.env.GITHUB_HEAD_REF = 'feature-branch';
    mockFetch([{ ok: true, status: 200, data: { workflow_runs: [] } }]);

    const adapter = new GitHubCiAdapter();
    const result = await adapter.downloadPreviousArtifact('radar-findings');
    expect(result).toBeNull();
  });
});
