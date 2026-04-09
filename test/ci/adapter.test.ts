import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to dynamically import to test env-var detection
describe('CI Adapter Factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear CI env vars
    delete process.env.GITHUB_ACTIONS;
    delete process.env.TF_BUILD;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.SYSTEM_ACCESSTOKEN;
    delete process.env.SYSTEM_COLLECTIONURI;
    delete process.env.SYSTEM_TEAMPROJECT;
    delete process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns GenericAdapter when no CI env vars are set', async () => {
    const { detectCiPlatform, GenericAdapter } = await import('../../src/ci/adapter.js');
    const adapter = await detectCiPlatform();
    expect(adapter).toBeInstanceOf(GenericAdapter);
    expect(adapter.platform).toBe('generic');
  });

  it('returns GitHubCiAdapter when GITHUB_ACTIONS=true', async () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_TOKEN = 'ghp_test1234';
    const { detectCiPlatform } = await import('../../src/ci/adapter.js');
    const adapter = await detectCiPlatform();
    expect(adapter.platform).toBe('github');
  });

  it('GenericAdapter capabilities are all false', async () => {
    const { GenericAdapter } = await import('../../src/ci/adapter.js');
    const adapter = new GenericAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.canComment).toBe(false);
    expect(caps.canAnnotate).toBe(false);
    expect(caps.canLabel).toBe(false);
    expect(caps.canUploadSarif).toBe(false);
    expect(caps.canSetStatus).toBe(false);
    expect(caps.canManageArtifacts).toBe(false);
  });

  it('GenericAdapter methods return no-op values', async () => {
    const { GenericAdapter } = await import('../../src/ci/adapter.js');
    const adapter = new GenericAdapter();

    expect(await adapter.postComment('test')).toBeNull();
    expect(await adapter.updateComment('marker', 'test')).toBeNull();
    expect(await adapter.postAnnotations([])).toBe(0);
    expect(await adapter.downloadPreviousArtifact('name')).toBeNull();
    // These should not throw
    await adapter.addLabels(['test']);
    await adapter.uploadSarif({ $schema: '', version: '2.1.0', runs: [] });
    await adapter.setStatus('success', 'test');
    await adapter.uploadArtifact('name', '/tmp/test');
  });
});
