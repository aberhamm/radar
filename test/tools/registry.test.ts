import { describe, it, expect } from 'vitest';
import { getToolDefinitions, executeTool } from '../../src/tools/registry.js';
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

describe('getToolDefinitions', () => {
  it('returns all tool definitions', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(20);
    const names = defs.map((d) => d.function.name);
    expect(names).toContain('list_directory');
    expect(names).toContain('record_finding');
    expect(names).toContain('assemble_output');
    expect(names).toContain('web_search');
  });

  it('all definitions have valid JSON Schema parameters', () => {
    for (const def of getToolDefinitions()) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters).toBeDefined();
    }
  });
});

describe('executeTool', () => {
  it('executes list_directory against fixture', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'list_directory', arguments: JSON.stringify({ path: '.', depth: 1 }) },
      },
      state,
    );
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('executes parse_package_json against fixture', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'parse_package_json', arguments: '{}' },
      },
      state,
    );
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('sitecore-minimal');
  });

  it('handles unknown tool gracefully', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_3',
        type: 'function',
        function: { name: 'nonexistent_tool', arguments: '{}' },
      },
      state,
    );
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Unknown tool');
  });

  it('tracks filesRead on read_file', async () => {
    const state = makeState();
    await executeTool(
      {
        id: 'call_4',
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) },
      },
      state,
    );
    expect(state.filesRead.has('package.json')).toBe(true);
  });
});
