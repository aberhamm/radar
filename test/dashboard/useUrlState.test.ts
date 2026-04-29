import { describe, it, expect } from 'vitest';
import { parseUrl, buildUrl } from '../../dashboard/src/lib/useUrlState.js';

describe('useUrlState', () => {
  describe('parseUrl', () => {
    it('parses / as idle', () => {
      expect(parseUrl('/')).toEqual({ view: 'idle' });
    });

    it('parses empty path as idle', () => {
      expect(parseUrl('')).toEqual({ view: 'idle' });
    });

    it('parses /run/{id} as run view', () => {
      expect(parseUrl('/run/abc-123')).toEqual({
        view: 'run',
        runId: 'abc-123',
        tab: undefined,
      });
    });

    it('parses /run/{id}?tab=cost as run view with tab', () => {
      const params = new URLSearchParams('tab=cost');
      expect(parseUrl('/run/abc-123', params)).toEqual({
        view: 'run',
        runId: 'abc-123',
        tab: 'cost',
      });
    });

    it('parses /run/{id}?tab=investigation', () => {
      const params = new URLSearchParams('tab=investigation');
      expect(parseUrl('/run/abc', params)).toEqual({
        view: 'run',
        runId: 'abc',
        tab: 'investigation',
      });
    });

    it('defaults invalid tab to undefined', () => {
      const params = new URLSearchParams('tab=bogus');
      expect(parseUrl('/run/abc', params)).toEqual({
        view: 'run',
        runId: 'abc',
        tab: undefined,
      });
    });

    it('parses /compare/{a}/{b} as compare view', () => {
      expect(parseUrl('/compare/id-a/id-b')).toEqual({
        view: 'compare',
        compareIds: ['id-a', 'id-b'],
      });
    });

    it('parses /multi/{id} as multi-goal view', () => {
      expect(parseUrl('/multi/parent-123')).toEqual({
        view: 'multi',
        parentId: 'parent-123',
      });
    });

    it('parses unknown path as idle (fallback)', () => {
      expect(parseUrl('/garbage/path')).toEqual({ view: 'idle' });
    });

    it('handles /run without an id as idle', () => {
      expect(parseUrl('/run')).toEqual({ view: 'idle' });
    });

    it('handles /compare with only one id as idle', () => {
      expect(parseUrl('/compare/only-one')).toEqual({ view: 'idle' });
    });

    // ─── New URL patterns (E3: Global Navigation) ─────────────

    it('parses /runs as runs view', () => {
      expect(parseUrl('/runs')).toEqual({ view: 'runs' });
    });

    it('parses /findings as findings view', () => {
      expect(parseUrl('/findings')).toEqual({
        view: 'findings',
        runId: undefined,
        findingId: undefined,
      });
    });

    it('parses /findings/{runId} as findings for a run', () => {
      expect(parseUrl('/findings/run-abc-123')).toEqual({
        view: 'findings',
        runId: 'run-abc-123',
        findingId: undefined,
      });
    });

    it('parses /findings/{runId}/{findingId} as findings detail view', () => {
      expect(parseUrl('/findings/run-abc-123/finding-xyz')).toEqual({
        view: 'findings',
        runId: 'run-abc-123',
        findingId: 'finding-xyz',
      });
    });

    it('parses /reports as reports view', () => {
      expect(parseUrl('/reports')).toEqual({ view: 'reports' });
    });

    it('parses /settings as settings view', () => {
      expect(parseUrl('/settings')).toEqual({ view: 'settings' });
    });
  });

  describe('buildUrl', () => {
    it('builds / for idle', () => {
      expect(buildUrl({ view: 'idle' })).toBe('/');
    });

    it('builds /run/{id} for run view', () => {
      expect(buildUrl({ view: 'run', runId: 'abc-123' })).toBe('/run/abc-123');
    });

    it('builds /run/{id}?tab=cost for run with non-report tab', () => {
      expect(buildUrl({ view: 'run', runId: 'abc', tab: 'cost' })).toBe('/run/abc?tab=cost');
    });

    it('omits ?tab= for overview tab (default)', () => {
      expect(buildUrl({ view: 'run', runId: 'abc', tab: 'overview' })).toBe('/run/abc');
    });

    it('builds /compare/{a}/{b} for compare view', () => {
      expect(buildUrl({ view: 'compare', compareIds: ['a', 'b'] })).toBe('/compare/a/b');
    });

    it('builds /multi/{id} for multi-goal view', () => {
      expect(buildUrl({ view: 'multi', parentId: 'xyz' })).toBe('/multi/xyz');
    });

    // ─── New URL patterns (E3: Global Navigation) ─────────────

    it('builds /runs for runs view', () => {
      expect(buildUrl({ view: 'runs' })).toBe('/runs');
    });

    it('builds /findings for findings list', () => {
      expect(buildUrl({ view: 'findings' })).toBe('/findings');
    });

    it('builds /findings/{runId} for run-scoped findings', () => {
      expect(buildUrl({ view: 'findings', runId: 'run-abc' })).toBe('/findings/run-abc');
    });

    it('builds /findings/{runId}/{findingId} for finding detail', () => {
      expect(buildUrl({ view: 'findings', runId: 'run-abc', findingId: 'finding-xyz' })).toBe('/findings/run-abc/finding-xyz');
    });

    it('builds /reports for reports view', () => {
      expect(buildUrl({ view: 'reports' })).toBe('/reports');
    });

    it('builds /settings for settings view', () => {
      expect(buildUrl({ view: 'settings' })).toBe('/settings');
    });
  });

  describe('round-trip', () => {
    const cases = [
      { view: 'idle' as const },
      { view: 'run' as const, runId: 'test-uuid-123' },
      { view: 'run' as const, runId: 'test-uuid', tab: 'cost' as const },
      { view: 'run' as const, runId: 'test-uuid', tab: 'investigation' as const },
      { view: 'compare' as const, compareIds: ['id-a', 'id-b'] as [string, string] },
      { view: 'multi' as const, parentId: 'parent-id' },
      // New patterns
      { view: 'runs' as const },
      { view: 'findings' as const },
      { view: 'findings' as const, runId: 'run-abc' },
      { view: 'findings' as const, runId: 'run-abc', findingId: 'finding-xyz' },
      { view: 'reports' as const },
      { view: 'settings' as const },
    ];

    for (const state of cases) {
      it(`round-trips ${state.view}${'findingId' in state && state.findingId ? `/${state.findingId}` : ''}${'tab' in state && state.tab ? `?tab=${state.tab}` : ''}`, () => {
        const url = buildUrl(state);
        const searchParams = url.includes('?')
          ? new URLSearchParams(url.split('?')[1])
          : undefined;
        const pathname = url.split('?')[0];
        const parsed = parseUrl(pathname, searchParams);

        // For run views without explicit tab, parsed.tab will be undefined
        if (state.view === 'run' && !('tab' in state)) {
          expect(parsed).toEqual({ ...state, tab: undefined });
        } else if (state.view === 'multi' && !('tab' in state)) {
          expect(parsed).toEqual({ ...state, tab: undefined });
        } else if (state.view === 'findings') {
          const expected = {
            ...state,
            runId: ('runId' in state ? state.runId : undefined) ?? undefined,
            findingId: ('findingId' in state ? state.findingId : undefined) ?? undefined,
          };
          expect(parsed).toEqual(expected);
        } else {
          expect(parsed).toEqual(state);
        }
      });
    }
  });
});
