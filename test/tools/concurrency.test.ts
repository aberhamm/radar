import { describe, it, expect } from 'vitest';
import { isReadOnly, isStateful, StatefulToolMutex } from '../../src/tools/concurrency.js';
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
    fileReadCache: new Map(),
  };
}

describe('isReadOnly / isStateful classification', () => {
  it('classifies read-only tools', () => {
    expect(isReadOnly('read_file')).toBe(true);
    expect(isReadOnly('grep_pattern')).toBe(true);
    expect(isReadOnly('find_files')).toBe(true);
    expect(isReadOnly('list_directory')).toBe(true);
    expect(isReadOnly('parse_package_json')).toBe(true);
    expect(isReadOnly('fetch_url')).toBe(true);
    expect(isReadOnly('web_search')).toBe(true);
    expect(isReadOnly('detect_app_roots')).toBe(true);
  });

  it('classifies stateful tools', () => {
    expect(isStateful('record_finding')).toBe(true);
    expect(isStateful('assemble_output')).toBe(true);
    expect(isStateful('switch_to_fast_model')).toBe(true);
  });

  it('read-only and stateful are disjoint', () => {
    expect(isReadOnly('record_finding')).toBe(false);
    expect(isStateful('read_file')).toBe(false);
  });

  it('unknown tool is neither', () => {
    expect(isReadOnly('unknown_tool')).toBe(false);
    expect(isStateful('unknown_tool')).toBe(false);
  });
});

describe('StatefulToolMutex', () => {
  it('serializes concurrent async operations', async () => {
    const mutex = new StatefulToolMutex();
    const order: number[] = [];

    // Fire 3 operations concurrently — they should complete in order 1, 2, 3
    const p1 = mutex.serialize(async () => {
      await delay(30);
      order.push(1);
      return 'a';
    });
    const p2 = mutex.serialize(async () => {
      await delay(10);
      order.push(2);
      return 'b';
    });
    const p3 = mutex.serialize(async () => {
      order.push(3);
      return 'c';
    });

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(['a', 'b', 'c']);
    // Without serialization, order would be [3, 2, 1] (shortest delay first).
    // With serialization, order is strictly [1, 2, 3].
    expect(order).toEqual([1, 2, 3]);
  });

  it('error in one operation does not break the chain', async () => {
    const mutex = new StatefulToolMutex();
    const order: number[] = [];

    const p1 = mutex.serialize(async () => {
      order.push(1);
      throw new Error('boom');
    });
    const p2 = mutex.serialize(async () => {
      order.push(2);
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    const result = await p2;
    expect(result).toBe('ok');
    expect(order).toEqual([1, 2]);
  });

  it('returns values from serialized operations', async () => {
    const mutex = new StatefulToolMutex();
    const result = await mutex.serialize(async () => 42);
    expect(result).toBe(42);
  });
});

describe('classification coverage', () => {
  it('every tool from buildPiTools() is classified as read-only or stateful', () => {
    const { tools } = buildPiTools(makeState());
    const unclassified = tools.filter((t) => !isReadOnly(t.name) && !isStateful(t.name));
    expect(unclassified.map((t) => t.name)).toEqual([]);
  });

  it('read-only and stateful sets are disjoint across all registered tools', () => {
    const { tools } = buildPiTools(makeState());
    const both = tools.filter((t) => isReadOnly(t.name) && isStateful(t.name));
    expect(both.map((t) => t.name)).toEqual([]);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
