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
    fileReadCache: new Map(),
  };
}

describe('buildPiTools', () => {
  it('returns 23 tools (19 + web_search + switch_to_fast_model + assemble_output + tool_search)', () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    expect(tools.length).toBe(23);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_directory');
    expect(names).toContain('record_finding');
    expect(names).toContain('assemble_output');
    expect(names).toContain('web_search');
    expect(names).toContain('tool_search');
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

  it('tool_search returns deferred tool entries', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const search = tools.find((t) => t.name === 'tool_search')!;
    const result = await search.execute('call_ts', { query: 'fetch' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches[0].name).toBe('fetch_url');
    expect(parsed.matches[0].fullDescription).toContain('HTML');
  });

  it('tool_search returns empty for no matches', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const search = tools.find((t) => t.name === 'tool_search')!;
    const result = await search.execute('call_ts2', { query: 'xyzzy_nothing' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.matches).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('deferred tools have stub descriptions', () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    const fetchUrl = tools.find((t) => t.name === 'fetch_url')!;
    expect(webSearch.description).toContain('tool_search');
    expect(fetchUrl.description).toContain('tool_search');
  });

  it('validation rejects bad input before execute', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const grep = tools.find((t) => t.name === 'grep_pattern')!;
    // pattern is required — empty should fail validation
    const result = await grep.execute('call_v', { pattern: '' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Validation');
    expect(text).toContain('pattern');
  });

  it('read_file returns unchanged for cached file', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const readFile = tools.find((t) => t.name === 'read_file')!;

    // First read — populates cache
    const r1 = await readFile.execute('call_r1', { path: 'package.json' });
    const p1 = JSON.parse((r1.content[0] as { type: 'text'; text: string }).text);
    expect(p1.unchanged).toBeUndefined();
    expect(p1.content).toContain('"name"');

    // Second read — should return unchanged
    const r2 = await readFile.execute('call_r2', { path: 'package.json' });
    const p2 = JSON.parse((r2.content[0] as { type: 'text'; text: string }).text);
    expect(p2.unchanged).toBe(true);
    expect(p2.content).toBe('[file_unchanged]');
  });

  it('read_file supports startLine parameter', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const readFile = tools.find((t) => t.name === 'read_file')!;
    const result = await readFile.execute('call_sl', { path: 'package.json', startLine: 3, maxLines: 2 });
    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.content).toContain('showing lines');
  });
});

describe('concurrency partitioning', () => {
  it('stateful tools serialize concurrent calls', async () => {
    const state = makeState();
    const { tools, assembledRef } = buildPiTools(state);
    const assemble = tools.find((t) => t.name === 'assemble_output')!;
    const switchModel = tools.find((t) => t.name === 'switch_to_fast_model')!;

    // Fire both concurrently — they should not interleave
    const [r1, r2] = await Promise.all([
      assemble.execute('c1', { sections: { overview: 'test' } }),
      switchModel.execute('c2', {}),
    ]);

    // Both should succeed without errors
    expect(r1.content[0].type).toBe('text');
    expect(r2.content[0].type).toBe('text');
    expect(assembledRef.sections).toEqual({ overview: 'test' });
  });

  it('read-only tools run without serialization', async () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    const listDir = tools.find((t) => t.name === 'list_directory')!;
    const findFiles = tools.find((t) => t.name === 'find_files')!;

    // Fire concurrently — both should complete (no deadlock, no serialization wait)
    const [r1, r2] = await Promise.all([
      listDir.execute('c1', { path: '.' }),
      findFiles.execute('c2', { pattern: '*.json' }),
    ]);

    expect(r1.content[0].type).toBe('text');
    expect(r2.content[0].type).toBe('text');
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
