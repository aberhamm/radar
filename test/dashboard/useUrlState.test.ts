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
  });

  describe('round-trip', () => {
    const cases = [
      { view: 'idle' as const },
      { view: 'run' as const, runId: 'test-uuid-123' },
      { view: 'run' as const, runId: 'test-uuid', tab: 'cost' as const },
      { view: 'run' as const, runId: 'test-uuid', tab: 'investigation' as const },
      { view: 'compare' as const, compareIds: ['id-a', 'id-b'] as [string, string] },
      { view: 'multi' as const, parentId: 'parent-id' },
    ];

    for (const state of cases) {
      it(`round-trips ${state.view}${('tab' in state && state.tab) ? `?tab=${state.tab}` : ''}`, () => {
        const url = buildUrl(state);
        const searchParams = url.includes('?')
          ? new URLSearchParams(url.split('?')[1])
          : undefined;
        const pathname = url.split('?')[0];
        const parsed = parseUrl(pathname, searchParams);

        // For run views without explicit tab, parsed.tab will be undefined
        if (state.view === 'run' && !('tab' in state)) {
          expect(parsed).toEqual({ ...state, tab: undefined });
        } else {
          expect(parsed).toEqual(state);
        }
      });
    }
  });
});
