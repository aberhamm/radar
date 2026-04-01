import { describe, it, expect } from 'vitest';
import { buildPiTools } from '../../src/tools/piToolAdapter.js';
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

describe('buildPiTools', () => {
  it('returns 21 tools (18 + web_search + switch_to_fast_model + assemble_output)', () => {
    const state = makeState();
    const { tools } = buildPiTools(state);
    expect(tools.length).toBe(21);
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
