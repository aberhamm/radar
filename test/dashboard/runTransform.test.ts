import { describe, it, expect } from 'vitest';

// Import via relative path since Vitest doesn't have the @/ alias for dashboard
// We use a dynamic import workaround: the function itself only depends on its param types
// which are structurally typed, so we can construct test data directly.

// For now, test the transform logic by re-implementing the import path.
// The module uses `@/lib/agentSession` for types only, so we just need the function.

// We'll add the alias to vitest.config.ts so the import works:
import { transformRunData, CATEGORIES, ACTION_CATEGORY_HINTS } from '../../dashboard/src/lib/runTransform.js';

describe('runTransform', () => {
  describe('transformRunData', () => {
    it('returns empty data for empty events', () => {
      const result = transformRunData([], { state: { findings: [] } } as any);

      expect(result.analysisTurns).toEqual([]);
      expect(result.findings).toEqual([]);
      expect(result.findingBatches).toEqual([0]); // [findings.length] when no batch events
    });

    it('groups tool calls into turns by reasoning changes', () => {
      const events = [
        { type: 'text_response', reasoning: 'First investigation', timestamp: '2026-04-02T18:25:22Z' },
        { type: 'tool_call', action: 'list_directory', args: '{"path":"."}', timestamp: '2026-04-02T18:25:23Z' },
        { type: 'tool_call', action: 'parse_package_json', args: '{"path":"package.json"}', timestamp: '2026-04-02T18:25:24Z' },
        { type: 'text_response', reasoning: 'Second investigation', timestamp: '2026-04-02T18:25:25Z' },
        { type: 'tool_call', action: 'read_file', args: '{"filePath":"src/index.ts"}', timestamp: '2026-04-02T18:25:26Z' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      expect(result.analysisTurns).toHaveLength(2);
      expect(result.analysisTurns[0].reasoning).toBe('First investigation');
      expect(result.analysisTurns[0].activities).toHaveLength(2);
      expect(result.analysisTurns[0].activities[0].label).toBe('list_directory');
      expect(result.analysisTurns[0].activities[1].label).toBe('parse_package_json');
      expect(result.analysisTurns[1].reasoning).toBe('Second investigation');
      expect(result.analysisTurns[1].activities).toHaveLength(1);
      expect(result.analysisTurns[1].activities[0].label).toBe('read_file');
    });

    it('detects switch_to_fast_model and splits turns', () => {
      const events = [
        { type: 'text_response', reasoning: 'Investigating', timestamp: '2026-04-02T18:25:22Z' },
        { type: 'tool_call', action: 'list_directory', args: '{"path":"."}', timestamp: '2026-04-02T18:25:23Z' },
        { type: 'tool_call', action: 'switch_to_fast_model', step: 10, timestamp: '2026-04-02T18:25:30Z' },
        { type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-02T18:25:31Z' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      // Should have the investigation turn + the switch turn
      const switchTurn = result.analysisTurns.find(t =>
        t.activities.some(a => a.label === 'switch_to_fast_model')
      );
      expect(switchTurn).toBeDefined();
      expect(switchTurn!.activities[0].detail).toBe('10 tool calls used');

      // Post-switch events (record_finding) should be skipped from turns
      const recordTurn = result.analysisTurns.find(t =>
        t.activities.some(a => a.label === 'record_finding')
      );
      expect(recordTurn).toBeUndefined();
    });

    it('extracts findings from result state', () => {
      const events = [] as any[];
      const resultState = {
        state: {
          findings: [
            {
              id: 'TEST-001',
              severity: 'high',
              category: 'security',
              title: 'Test finding',
              description: 'A test finding',
              evidence: [{ filePath: 'src/index.ts' }],
              investigationNote: 'Found during test',
              tags: ['test'],
            },
            {
              id: 'TEST-002',
              severity: 'low',
              category: 'stack',
              title: 'Another finding',
            },
          ],
        },
      } as any;

      const result = transformRunData(events, resultState);

      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]).toMatchObject({
        id: 'TEST-001',
        severity: 'high',
        category: 'security',
        title: 'Test finding',
        evidenceFiles: ['src/index.ts'],
        note: 'Found during test',
        tags: ['test'],
      });
      // Second finding has missing optional fields — should use safe defaults
      expect(result.findings[1]).toMatchObject({
        id: 'TEST-002',
        severity: 'low',
        evidenceFiles: [],
        note: '',
        tags: [],
      });
    });

    it('computes finding batches from batchId groupings', () => {
      const events = [
        { type: 'tool_call', action: 'record_finding', batchId: 'batch-1' },
        { type: 'tool_call', action: 'record_finding', batchId: 'batch-1' },
        { type: 'tool_call', action: 'record_finding', batchId: 'batch-1' },
        { type: 'tool_call', action: 'record_finding', batchId: 'batch-2' },
        { type: 'tool_call', action: 'record_finding', batchId: 'batch-2' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      expect(result.findingBatches).toEqual([3, 2]);
    });

    it('infers categories from tool actions', () => {
      const events = [
        { type: 'text_response', reasoning: 'Checking config', timestamp: '2026-04-02T18:25:22Z' },
        { type: 'tool_call', action: 'parse_package_json', args: '{}', timestamp: '2026-04-02T18:25:23Z' },
        { type: 'tool_call', action: 'analyze_env_usage', args: '{}', timestamp: '2026-04-02T18:25:24Z' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      expect(result.analysisTurns).toHaveLength(1);
      const cats = result.analysisTurns[0].categoriesCovered;
      expect(cats).toContain('stack');
      expect(cats).toContain('dependencies');
      expect(cats).toContain('configuration');
      expect(cats).toContain('security');
    });

    it('handles malformed args JSON gracefully', () => {
      const events = [
        { type: 'text_response', reasoning: 'Testing', timestamp: '2026-04-02T18:25:22Z' },
        { type: 'tool_call', action: 'read_file', args: 'not-json', timestamp: '2026-04-02T18:25:23Z' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      expect(result.analysisTurns).toHaveLength(1);
      expect(result.analysisTurns[0].activities[0].files).toEqual([]);
    });

    it('deduplicates same action within a turn', () => {
      const events = [
        { type: 'text_response', reasoning: 'Reading files', timestamp: '2026-04-02T18:25:22Z' },
        { type: 'tool_call', action: 'read_file', args: '{"filePath":"a.ts"}', timestamp: '2026-04-02T18:25:23Z' },
        { type: 'tool_call', action: 'read_file', args: '{"filePath":"b.ts"}', timestamp: '2026-04-02T18:25:24Z' },
      ] as any[];

      const result = transformRunData(events, { state: { findings: [] } } as any);

      expect(result.analysisTurns[0].activities).toHaveLength(1);
      expect(result.analysisTurns[0].activities[0].label).toBe('read_file');
      expect(result.analysisTurns[0].activities[0].files).toEqual(['a.ts', 'b.ts']);
    });
  });

  describe('CATEGORIES', () => {
    it('has expected category count', () => {
      expect(CATEGORIES.length).toBe(11);
    });
  });

  describe('ACTION_CATEGORY_HINTS', () => {
    it('maps parse_package_json to stack and dependencies', () => {
      expect(ACTION_CATEGORY_HINTS.parse_package_json).toEqual(['stack', 'dependencies']);
    });
  });
});
