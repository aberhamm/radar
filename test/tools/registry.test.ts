import { describe, it, expect } from 'vitest';
import { buildPiTools, normalizePathArgs } from '../../src/tools/piToolAdapter.js';
import type { AgentState } from '../../src/types/state.js';
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

/** Helper: execute a tool by name through buildPiTools */
async function executeTool(name: string, args: Record<string, unknown>, state: AgentState): Promise<string> {
  const { tools } = buildPiTools(state);
  const tool = tools.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const result = await tool.execute('test-id', args);
  // Pi tools return { content: [{type:'text', text}], details }
  const text = result.content[0];
  if (text && 'text' in text) return text.text;
  return JSON.stringify({ error: 'Unexpected result format' });
}

describe('executeTool (via buildPiTools)', () => {
  it('executes list_directory against fixture', async () => {
    const state = makeState();
    const result = await executeTool('list_directory', { path: '.', depth: 1 }, state);
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('executes parse_package_json against fixture', async () => {
    const state = makeState();
    const result = await executeTool('parse_package_json', {}, state);
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('sitecore-minimal');
  });

  it('handles unknown tool gracefully', async () => {
    const state = makeState();
    const result = await executeTool('nonexistent_tool', {}, state);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Unknown tool');
  });

  it('normalizes absolute path "/" to repo root', async () => {
    const state = makeState();
    const result = await executeTool('list_directory', { path: '/' }, state);
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBeGreaterThan(0);
    const names = parsed.entries.map((e: { name: string }) => e.name);
    expect(names).toContain('package.json');
  });

  it('normalizes absolute path "/src" to relative "src"', async () => {
    const state = makeState();
    const result = await executeTool('list_directory', { path: '/src' }, state);
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('coerces stringified JSON array for paths argument', async () => {
    const state = makeState();
    const result = await executeTool('read_files_batch', { paths: '["package.json"]' }, state);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.files).toBeDefined();
  });

  it('handles non-JSON string for paths argument gracefully', async () => {
    const state = makeState();
    const result = await executeTool('read_files_batch', { paths: 'not-valid-json' }, state);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it('tracks filesRead on read_file', async () => {
    const state = makeState();
    await executeTool('read_file', { path: 'package.json' }, state);
    expect(state.filesRead.has('package.json')).toBe(true);
  });
});

describe('normalizePathArgs', () => {
  it('strips leading slashes from path', () => {
    const result = normalizePathArgs({ path: '/src/components' });
    expect(result.path).toBe('src/components');
  });

  it('normalizes "/" to "."', () => {
    const result = normalizePathArgs({ path: '/' });
    expect(result.path).toBe('.');
  });

  it('coerces stringified JSON array for paths', () => {
    const result = normalizePathArgs({ paths: '["a.ts","b.ts"]' });
    expect(result.paths).toEqual(['a.ts', 'b.ts']);
  });

  it('strips leading slashes from array paths', () => {
    const result = normalizePathArgs({ paths: ['/src/a.ts', '/b.ts'] });
    expect(result.paths).toEqual(['src/a.ts', 'b.ts']);
  });
});
