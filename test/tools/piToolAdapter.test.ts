import { describe, it, expect, afterEach } from 'vitest';
import { buildPiTools, spillAndTruncate, cleanupSpillDir } from '../../src/tools/piToolAdapter.js';
import type { AgentState } from '../../src/types/state.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

function makeState(): AgentState {
  return {
    goal: 'onboarding',
    repo: { source: 'local', localPath: FIXTURE, name: 'test' },
    resolvedVersions: {},
    findings: [],
    filesRead: new Set(),
    toolCallCount: 0,
    toolCallBudget: 50,
    webSearchCount: 0,
    webSearchBudget: 5,
    urlFetchCount: 0,
    urlFetchBudget: 3,
    docTokensUsed: 0,
    docTokenBudget: 20000,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
  };
}

describe('buildPiTools', () => {
  it('returns 22 tools (19 + web_search + switch_to_fast_model + assemble_output)', () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    expect(tools.length).toBe(22);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_directory');
    expect(names).toContain('record_finding');
    expect(names).toContain('assemble_output');
    expect(names).toContain('web_search');
  });

  it('all tools have name, label, description, parameters, execute', () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('executes list_directory through Pi tool format', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const listDir = tools.find((t) => t.name === 'list_directory')!;
    const result = await listDir.execute('call_1', { path: '.', depth: 1 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('assemble_output stores sections in assembledRef', async () => {
    const state = makeState();
    const { tools, assembledRef } = buildPiTools(state);
    const assemble = tools.find((t) => t.name === 'assemble_output')!;
    expect(assembledRef.sections).toBeNull();
    await assemble.execute('call_2', { sections: { project_overview: '## Overview\nTest' } });
    expect(assembledRef.sections).toEqual({ project_overview: '## Overview\nTest' });
  });
});

describe('spillAndTruncate', () => {
  afterEach(() => {
    cleanupSpillDir();
  });

  it('returns unchanged for small results', () => {
    const small = JSON.stringify({ data: 'hello' });
    expect(spillAndTruncate('list_directory', small)).toBe(small);
  });

  it('truncates at per-tool limit for large results', () => {
    // Default limit is 4000 for unknown tools
    const large = 'x'.repeat(5000);
    const result = spillAndTruncate('list_directory', large);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain('truncated');
    expect(result).toContain('1000 chars omitted');
  });

  it('uses per-tool limit (grep_pattern gets 20K)', () => {
    const medium = 'x'.repeat(10_000);
    // grep_pattern limit is 20K, so 10K should pass through unchanged
    expect(spillAndTruncate('grep_pattern', medium)).toBe(medium);

    // But 25K should truncate
    const large = 'x'.repeat(25_000);
    const result = spillAndTruncate('grep_pattern', large);
    expect(result).toContain('truncated');
  });

  it('writes full result to disk when truncating', () => {
    const large = 'x'.repeat(5000);
    const result = spillAndTruncate('list_directory', large);
    // Extract file path from the truncation message
    const match = result.match(/Full result: (.+)\]/);
    expect(match).toBeTruthy();
    const filepath = match![1];
    expect(existsSync(filepath)).toBe(true);
    expect(readFileSync(filepath, 'utf-8')).toBe(large);
  });

  it('cleanupSpillDir removes spill directory', () => {
    // Trigger a spill to create the directory
    spillAndTruncate('list_directory', 'x'.repeat(5000));
    cleanupSpillDir();
    // After cleanup, next spill should create a new directory
    const result = spillAndTruncate('list_directory', 'x'.repeat(5000));
    const match = result.match(/Full result: (.+)\]/);
    expect(match).toBeTruthy();
  });
});
