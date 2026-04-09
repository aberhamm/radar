import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsCiAdapter } from '../../src/ci/azureDevops.js';
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

describe('AzureDevOpsCiAdapter', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SYSTEM_ACCESSTOKEN = 'test-ado-token-12345';
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/myorg/';
    process.env.SYSTEM_TEAMPROJECT = 'MyProject';
    process.env.BUILD_REPOSITORY_ID = 'repo-guid-123';
    process.env.BUILD_BUILDID = '999';
    process.env.SYSTEM_PULLREQUEST_PULLREQUESTID = '55';

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sets default capabilities with PR context', () => {
    const adapter = new AzureDevOpsCiAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.canComment).toBe(true);
    expect(caps.canAnnotate).toBe(true);
    expect(caps.canUploadSarif).toBe(false);
    expect(caps.canManageArtifacts).toBe(true);
  });

  it('disables PR features when no PR ID', () => {
    delete process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    const adapter = new AzureDevOpsCiAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.canComment).toBe(false);
    expect(caps.canAnnotate).toBe(false);
  });

  it('probeCapabilities disables features on 403', async () => {
    mockFetch([{ ok: false, status: 403, text: 'Unauthorized' }]);

    const adapter = new AzureDevOpsCiAdapter();
    await adapter.probeCapabilities();
    expect(adapter.getCapabilities().canComment).toBe(false);
  });

  it('probeCapabilities enables label and status on success', async () => {
    mockFetch([{ ok: true, status: 200, data: { status: 'active' } }]);

    const adapter = new AzureDevOpsCiAdapter();
    await adapter.probeCapabilities();
    expect(adapter.getCapabilities().canLabel).toBe(true);
    expect(adapter.getCapabilities().canSetStatus).toBe(true);
  });

  it('postComment creates PR thread', async () => {
    mockFetch([{ ok: true, status: 200, data: { id: 123 } }]);

    const adapter = new AzureDevOpsCiAdapter();
    const url = await adapter.postComment('Test body');
    expect(url).toContain('threadId=123');

    const [callUrl, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(callUrl).toContain('pullRequests/55/threads');
    const body = JSON.parse(opts.body);
    expect(body.comments[0].content).toBe('Test body');
  });

  it('postComment returns null on failure', async () => {
    mockFetch([{ ok: false, status: 404, text: 'PR not found' }]);

    const adapter = new AzureDevOpsCiAdapter();
    const url = await adapter.postComment('Test');
    expect(url).toBeNull();
  });

  it('updateComment finds thread with marker and patches', async () => {
    mockFetch([
      // List threads
      { ok: true, status: 200, data: {
        value: [
          { id: 10, comments: [{ id: 1, content: 'other thread' }] },
          { id: 20, comments: [{ id: 2, content: 'contains <!-- radar-ci-comment --> marker' }] },
        ],
      }},
      // Patch comment
      { ok: true, status: 200, data: {} },
    ]);

    const adapter = new AzureDevOpsCiAdapter();
    const url = await adapter.updateComment('<!-- radar-ci-comment -->', 'Updated');
    expect(url).toContain('threadId=20');
  });

  it('updateComment creates new thread when marker not found', async () => {
    mockFetch([
      // List threads — none with marker (less than page size → no pagination)
      { ok: true, status: 200, data: { value: [] } },
      // Post new thread
      { ok: true, status: 200, data: { id: 99 } },
    ]);

    const adapter = new AzureDevOpsCiAdapter();
    const url = await adapter.updateComment('<!-- radar-ci-comment -->', 'New');
    expect(url).toContain('threadId=99');
  });

  it('postAnnotations creates file-anchored threads', async () => {
    mockFetch([
      { ok: true, status: 200, data: { id: 1 } },
      { ok: true, status: 200, data: { id: 2 } },
    ]);

    const adapter = new AzureDevOpsCiAdapter();
    const findings = [makeFinding(), makeFinding({ id: 'F-002', severity: 'medium' })];
    const count = await adapter.postAnnotations(findings);
    expect(count).toBe(2);

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.threadContext.filePath).toBe('/src/config.ts');
    expect(body.threadContext.rightFileStart.line).toBe(42);
  });

  it('addLabels disables on 403', async () => {
    mockFetch([{ ok: false, status: 403, text: 'Forbidden' }]);

    const adapter = new AzureDevOpsCiAdapter();
    // Manually enable labels for this test
    (adapter as any).capabilities.canLabel = true;
    await adapter.addLabels(['radar:test']);
    expect(adapter.getCapabilities().canLabel).toBe(false);
  });

  it('uploadSarif is a no-op', async () => {
    const adapter = new AzureDevOpsCiAdapter();
    // Should not throw
    await adapter.uploadSarif({
      $schema: 'test',
      version: '2.1.0',
      runs: [],
    });
  });

  it('downloadPreviousArtifact returns null without SYSTEM_DEFINITIONID', async () => {
    const adapter = new AzureDevOpsCiAdapter();
    const result = await adapter.downloadPreviousArtifact('radar-findings');
    expect(result).toBeNull();
  });
});
