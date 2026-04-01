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

  it('normalizes absolute path "/" to repo root', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_abs',
        type: 'function',
        function: { name: 'list_directory', arguments: JSON.stringify({ path: '/' }) },
      },
      state,
    );
    const parsed = JSON.parse(result);
    // Should list the fixture repo root, not the filesystem root
    expect(parsed.entries.length).toBeGreaterThan(0);
    const names = parsed.entries.map((e: { name: string }) => e.name);
    expect(names).toContain('package.json');
  });

  it('normalizes absolute path "/src" to relative "src"', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_abs2',
        type: 'function',
        function: { name: 'list_directory', arguments: JSON.stringify({ path: '/src' }) },
      },
      state,
    );
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('coerces stringified JSON array for paths argument', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_coerce',
        type: 'function',
        function: {
          name: 'read_files_batch',
          arguments: JSON.stringify({ paths: '["package.json"]' }),
        },
      },
      state,
    );
    const parsed = JSON.parse(result);
    // Should succeed — paths was coerced from string to array
    expect(parsed.error).toBeUndefined();
    expect(parsed.files).toBeDefined();
  });

  it('handles non-JSON string for paths argument gracefully', async () => {
    const state = makeState();
    const result = await executeTool(
      {
        id: 'call_bad_paths',
        type: 'function',
        function: {
          name: 'read_files_batch',
          arguments: JSON.stringify({ paths: 'not-valid-json' }),
        },
      },
      state,
    );
    const parsed = JSON.parse(result);
    // Should fail with a clear error (not a crash)
    expect(parsed.error).toBeDefined();
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
