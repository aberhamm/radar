import { describe, it, expect } from 'vitest';
import { groupByRepo } from '../../dashboard/src/components/Sidebar.js';
import type { HistoryItem } from '../../dashboard/src/lib/agentSession.js';

function makeItem(overrides: Partial<HistoryItem> & { id: string; repoName: string }): HistoryItem {
  return {
    goal: 'audit',
    startedAt: '2026-04-10T12:00:00Z',
    hasResult: true,
    ...overrides,
  };
}

describe('groupByRepo', () => {
  it('returns empty groups for empty history', () => {
    expect(groupByRepo([])).toEqual([]);
  });

  it('groups 3 runs from the same repo into one repo group', () => {
    const items: HistoryItem[] = [
      makeItem({ id: '1', repoName: 'my-repo', startedAt: '2026-04-10T12:00:00Z' }),
      makeItem({ id: '2', repoName: 'my-repo', startedAt: '2026-04-10T13:00:00Z' }),
      makeItem({ id: '3', repoName: 'my-repo', startedAt: '2026-04-10T14:00:00Z' }),
    ];
    const groups = groupByRepo(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].repoName).toBe('my-repo');
    expect(groups[0].runs).toHaveLength(3);
  });

  it('creates separate repo groups for different repos, sorted by most recent', () => {
    const items: HistoryItem[] = [
      makeItem({ id: '1', repoName: 'repo-a', startedAt: '2026-04-08T12:00:00Z' }),
      makeItem({ id: '2', repoName: 'repo-b', startedAt: '2026-04-09T12:00:00Z' }),
      makeItem({ id: '3', repoName: 'repo-c', startedAt: '2026-04-10T12:00:00Z' }),
    ];
    const groups = groupByRepo(items);
    expect(groups).toHaveLength(3);
    // Most recent first
    expect(groups[0].repoName).toBe('repo-c');
    expect(groups[1].repoName).toBe('repo-b');
    expect(groups[2].repoName).toBe('repo-a');
  });

  it('nests multi-goal runs under repo group as a 2-level hierarchy', () => {
    const items: HistoryItem[] = [
      makeItem({ id: 'child-1', repoName: 'my-repo', parentRunId: 'parent-1', goal: 'audit' }),
      makeItem({ id: 'child-2', repoName: 'my-repo', parentRunId: 'parent-1', goal: 'security' }),
      makeItem({ id: 'solo-1', repoName: 'my-repo', goal: 'onboarding' }),
    ];
    const groups = groupByRepo(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].repoName).toBe('my-repo');

    // Should have 2 entries: one multigoal group + one single
    const multigoal = groups[0].runs.filter(r => r.type === 'multigoal');
    const singles = groups[0].runs.filter(r => r.type === 'single');
    expect(multigoal).toHaveLength(1);
    expect(singles).toHaveLength(1);

    if (multigoal[0].type === 'multigoal') {
      expect(multigoal[0].children).toHaveLength(2);
      expect(multigoal[0].parentId).toBe('parent-1');
    }
  });

  it('puts sample run (__sample__) last, not grouped by repo', () => {
    const items: HistoryItem[] = [
      makeItem({ id: '__sample__', repoName: 'Demo Run', startedAt: '2026-04-02T18:25:21Z' }),
      makeItem({ id: '1', repoName: 'my-repo', startedAt: '2026-04-10T12:00:00Z' }),
    ];
    const groups = groupByRepo(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].repoName).toBe('my-repo');
    expect(groups[1].repoName).toBe('Demo Run');
  });

  it('computes worst score across runs in a repo group', () => {
    const items: HistoryItem[] = [
      makeItem({ id: '1', repoName: 'my-repo', score: 'green' }),
      makeItem({ id: '2', repoName: 'my-repo', score: 'red' }),
      makeItem({ id: '3', repoName: 'my-repo', score: 'yellow' }),
    ];
    const groups = groupByRepo(items);
    expect(groups[0].worstScore).toBe('red');
  });

  it('handles runs with no score', () => {
    const items: HistoryItem[] = [
      makeItem({ id: '1', repoName: 'my-repo', score: null }),
      makeItem({ id: '2', repoName: 'my-repo', score: 'green' }),
    ];
    const groups = groupByRepo(items);
    expect(groups[0].worstScore).toBe('green');
  });
});
