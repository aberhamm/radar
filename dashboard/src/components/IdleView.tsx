'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { StaggeredSpinner, HistoryLoadingSkeleton, CachedReposLoadingSkeleton } from '@/components/Skeleton';
import { ALL_GOALS } from '@/lib/goals';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const GOAL_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  audit: 'Audit',
  'audit-generic': 'Generic Audit',
  migration: 'Migration',
  'component-map': 'Components',
  'ci-check': 'CI Check',
  'security-review': 'Security',
  nextjs: 'Next.js',
  accessibility: 'Accessibility',
  performance: 'Performance',
};

const PRESETS = [
  { label: 'All Goals', goals: ALL_GOALS as readonly string[] },
  { label: 'Security', goals: ['audit', 'security-review', 'ci-check'] as readonly string[] },
  { label: 'Frontend', goals: ['nextjs', 'accessibility', 'performance', 'component-map'] as readonly string[] },
];

interface HistoryRunItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
  findingsCount?: number;
  score?: 'red' | 'yellow' | 'green' | null;
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
  parentRunId?: string;
}

interface AppRoot {
  path: string;
  type: string;
  hasPackageJson: boolean;
  framework?: string;
  frameworkVersion?: string;
  plugins?: string[];
}

interface IdleViewProps {
  initialRepoPath?: string;
  onStart: (repoPath: string, goal: string, repoName?: string, appRoot?: string, runId?: string, budget?: number, goals?: string[], parallel?: boolean) => void;
  history?: HistoryRunItem[];
  historyReady?: boolean;
  compact?: boolean;
}

interface CachedRepo {
  owner: string;
  repo: string;
  localPath: string;
  defaultBranch: string;
  lastCommit: { hash: string; date: string };
}

function isGitHubUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  // owner/repo shorthand (e.g. "aberhamm/xmcloud-starter-js")
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed);
}

function expandRepoInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }
  return trimmed;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function scoreColor(score: 'red' | 'yellow' | 'green' | null | undefined): string {
  if (score === 'green') return 'bg-success';
  if (score === 'yellow') return 'bg-warning';
  if (score === 'red') return 'bg-danger';
  return 'bg-quaternary-label';
}

export function IdleView({ initialRepoPath = '', onStart, history = [], historyReady = true, compact = false }: IdleViewProps) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set(ALL_GOALS));
  const [budget, setBudget] = useState<number | null>(null);
  const [parallel, setParallel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Clone state for GitHub URLs
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'cloning' | 'cloned'>('idle');
  const [clonedPath, setClonedPath] = useState('');
  const [clonedRepoName, setClonedRepoName] = useState('');
  const [clonedCached, setClonedCached] = useState(false);

  // Friendly display name shown in input when repo is selected from lists
  const [displayName, setDisplayName] = useState('');

  // Cached repos from .repos/
  const [cachedRepos, setCachedRepos] = useState<CachedRepo[]>([]);
  const [cachedReposReady, setCachedReposReady] = useState(false);
  const [showAllCached, setShowAllCached] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Pulling state for rerun (auto-pull git repos)
  const [rerunPulling, setRerunPulling] = useState(false);

  // Track which specific history run is selected (by id) to avoid highlighting duplicates
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  // Monorepo root detection
  const [detectedRoots, setDetectedRoots] = useState<AppRoot[]>([]);
  const [isMonorepo, setIsMonorepo] = useState(false);
  const [monorepoTool, setMonorepoTool] = useState<string | undefined>();
  const [selectedRoot, setSelectedRoot] = useState<string>('__entire__');
  const effectiveRoot = selectedRoot === '__entire__' ? '' : selectedRoot;
  const [detectingRoots, setDetectingRoots] = useState(false);

  // Progressive goal picker — collapsed by default
  const [goalsExpanded, setGoalsExpanded] = useState(false);

  const isUrl = isGitHubUrl(repoPath);
  const isCloned = cloneStatus === 'cloned';
  const isCloning = cloneStatus === 'cloning';

  const isFirstTime = history.length === 0;

  // Keyboard navigation ref for run list
  const runListRef = useRef<HTMLDivElement>(null);

  // Fetch cached repos on mount
  useEffect(() => {
    fetch('/api/repos')
      .then(r => r.json())
      .then(data => {
        if (data.repos) setCachedRepos(data.repos);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setCachedReposReady(true));
  }, []);

  // Detect app roots for a repo path — called after clone or when a local path is ready
  const detectRoots = useCallback(async (repoLocalPath: string) => {
    setDetectingRoots(true);
    try {
      const res = await fetch('/api/detect-roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repoLocalPath }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setDetectedRoots(data.roots ?? []);
      setIsMonorepo(data.isMonorepo ?? false);
      setMonorepoTool(data.monorepoTool);
      setSelectedRoot('__entire__');
    } catch { /* ignore detection failures */ }
    finally { setDetectingRoots(false); }
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setRepoPath(value);
    setDisplayName('');
    setError('');
    if (cloneStatus !== 'idle') {
      setCloneStatus('idle');
      setClonedPath('');
      setClonedRepoName('');
      setClonedCached(false);
      setDetectedRoots([]);
      setIsMonorepo(false);
      setSelectedRoot('__entire__');
    }
  }, [cloneStatus]);

  // Detect roots when a local path is entered and input loses focus
  const handleInputBlur = useCallback(() => {
    const trimmed = repoPath.trim();
    if (trimmed && !isGitHubUrl(trimmed) && cloneStatus === 'idle') {
      detectRoots(trimmed);
    }
  }, [repoPath, cloneStatus, detectRoots]);

  const handleSelectCached = useCallback((repo: CachedRepo) => {
    setRepoPath(`https://github.com/${repo.owner}/${repo.repo}`);
    setDisplayName(`${repo.owner}/${repo.repo}`);
    setClonedPath(repo.localPath);
    setClonedRepoName(`${repo.owner}/${repo.repo}`);
    setClonedCached(true);
    setCloneStatus('cloned');
    setError('');
    detectRoots(repo.localPath);
  }, [detectRoots]);

  const handleSelectHistoryRun = useCallback(async (run: HistoryRunItem) => {
    setError('');
    setSelectedHistoryId(run.parentRunId ?? run.id);

    if (run.goal === 'all') {
      setSelectedGoals(new Set(ALL_GOALS));
    } else {
      setSelectedGoals(new Set([run.goal]));
    }

    if (run.repoSource === 'github' && run.repoUrl) {
      setRepoPath(run.repoUrl);
      setDisplayName(run.repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''));
      setRerunPulling(true);
      setCloneStatus('cloning');
      try {
        const res = await fetch('/api/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: run.repoUrl }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to pull repository');
          setCloneStatus('idle');
          setRerunPulling(false);
          return;
        }
        setClonedPath(data.localPath);
        setClonedRepoName(data.repoName);
        setClonedCached(true);
        setCloneStatus('cloned');

        // Detect app roots for monorepo selection
        detectRoots(data.localPath);

        // Refresh cached repos list
        fetch('/api/repos')
          .then(r => r.json())
          .then(d => { if (d.repos) setCachedRepos(d.repos); })
          .catch(() => { /* ignore */ });
      } catch (err) {
        setError((err as Error).message);
        setCloneStatus('idle');
      } finally {
        setRerunPulling(false);
      }
    } else if (run.repoPath) {
      setRepoPath(run.repoPath);
      setDisplayName(run.repoName);
      setCloneStatus('idle');
      setClonedPath('');
      setClonedRepoName('');
      setClonedCached(false);
      detectRoots(run.repoPath);
    }
  }, [detectRoots]);

  const handleClone = async () => {
    if (!repoPath.trim()) return;
    setError('');
    setCloneStatus('cloning');
    const cloneUrl = expandRepoInput(repoPath);
    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cloneUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to clone repository');
        setCloneStatus('idle');
        return;
      }
      setClonedPath(data.localPath);
      setClonedRepoName(data.repoName);
      setClonedCached(!!data.cached);
      setCloneStatus('cloned');
      if (!displayName) {
        setDisplayName(repoPath.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''));
      }

      detectRoots(data.localPath);

      fetch('/api/repos')
        .then(r => r.json())
        .then(d => { if (d.repos) setCachedRepos(d.repos); })
        .catch(() => { /* ignore */ });
    } catch (err) {
      setError((err as Error).message);
      setCloneStatus('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If it's a URL that hasn't been cloned yet, clone first
    if (isUrl && !isCloned) {
      await handleClone();
      return;
    }

    const targetPath = isCloned ? clonedPath : repoPath.trim();
    if (!targetPath) {
      setError('Repo path is required');
      return;
    }

    setError('');
    setLoading(true);

    const goalsList = [...selectedGoals];
    if (goalsList.length === 0) {
      setError('Select at least one goal');
      setLoading(false);
      return;
    }

    const effectiveGoal = goalsList.length === 1 ? goalsList[0] : 'all';
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: targetPath,
          goal: effectiveGoal,
          ...(goalsList.length > 1 ? { goals: goalsList } : {}),
          ...(isCloned ? { repoSource: 'github', repoUrl: repoPath.trim() } : {}),
          ...(effectiveRoot ? { appRoot: effectiveRoot } : {}),
          ...(budget != null ? { budget } : {}),
          ...(parallel && goalsList.length > 1 ? { parallel: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start run');
        setLoading(false);
        return;
      }
      onStart(targetPath, effectiveGoal, isCloned ? clonedRepoName : undefined, effectiveRoot || undefined, data.runId, data.budget, goalsList.length > 1 ? goalsList : undefined, parallel && goalsList.length > 1 ? true : undefined);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  // Determine button label and state
  let buttonLabel: string;
  let buttonDisabled: boolean;
  const noGoals = selectedGoals.size === 0;
  if (isCloning || rerunPulling) {
    buttonLabel = 'Pulling...';
    buttonDisabled = true;
  } else if (isCloned) {
    buttonLabel = loading ? 'Starting...' : 'Start Analysis';
    buttonDisabled = loading || noGoals;
  } else if (isUrl) {
    buttonLabel = 'Pull Repo';
    buttonDisabled = false;
  } else {
    buttonLabel = loading ? 'Starting...' : 'Start Analysis';
    buttonDisabled = loading || noGoals;
  }

  // Collapse multi-goal children into a single "all" entry per parentRunId
  const deduplicatedHistory = useMemo(() => {
    const seen = new Set<string>();
    const result: HistoryRunItem[] = [];
    for (const run of history) {
      if (run.parentRunId) {
        if (seen.has(run.parentRunId)) continue;
        seen.add(run.parentRunId);
        result.push({ ...run, goal: 'all' });
      } else if (run.goal !== 'all') {
        result.push(run);
      }
    }
    return result;
  }, [history]);

  // Portfolio metrics — computed from real history
  const metrics = useMemo(() => {
    const completedRuns = history.filter(r => r.completedAt);
    const uniqueRepos = new Set(completedRuns.map(r => r.repoName)).size;
    const totalFindings = completedRuns.reduce((sum, r) => sum + (r.findingsCount ?? 0), 0);
    const criticalFindings = completedRuns.filter(r => r.score === 'red').length;

    const lastRun = completedRuns.sort((a, b) =>
      new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    )[0];

    return {
      repos: uniqueRepos,
      runs: completedRuns.length,
      findings: totalFindings,
      criticals: criticalFindings,
      lastRun: lastRun?.completedAt ? relativeTime(lastRun.completedAt) : 'never',
    };
  }, [history]);

  // Keyboard navigation for run list
  const handleRunListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const container = runListRef.current;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-run-row]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(current + 1, buttons.length - 1);
      buttons[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(current - 1, 0);
      buttons[prev].focus();
    }
  }, []);

  // ─── Goal picker section ─────────────────────────────────────────

  const goalSummary = selectedGoals.size === ALL_GOALS.length
    ? 'All goals'
    : selectedGoals.size === 0
      ? 'No goals selected'
      : `${selectedGoals.size} of ${ALL_GOALS.length} goals`;

  const goalPickerContent = (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-secondary-label">
          Goals
        </label>
        <button
          type="button"
          onClick={() => setGoalsExpanded(v => !v)}
          className="text-[11px] text-tint hover:underline cursor-pointer min-h-[44px] flex items-center px-1"
          aria-expanded={goalsExpanded}
        >
          {goalsExpanded ? 'Done' : `Customize (${goalSummary})`}
        </button>
      </div>
      {!goalsExpanded && (
        <div className="flex items-center gap-1.5">
          {PRESETS.map(preset => {
            const isActive = preset.goals.length === selectedGoals.size && preset.goals.every(g => selectedGoals.has(g));
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setSelectedGoals(new Set(preset.goals))}
                disabled={loading || isCloning || rerunPulling}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer min-h-[44px] ${
                  isActive
                    ? 'bg-tint text-white'
                    : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
      {goalsExpanded && (
        <div className="animate-expand-down">
          <div className="flex items-center gap-1.5 mb-2">
            {PRESETS.map(preset => {
              const isActive = preset.goals.length === selectedGoals.size && preset.goals.every(g => selectedGoals.has(g));
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSelectedGoals(new Set(preset.goals))}
                  disabled={loading || isCloning || rerunPulling}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer min-h-[44px] ${
                    isActive
                      ? 'bg-tint text-white'
                      : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSelectedGoals(new Set())}
              disabled={loading || isCloning || rerunPulling}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-elevated text-tertiary-label hover:text-secondary-label transition-all cursor-pointer min-h-[44px]"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(ALL_GOALS as readonly string[]).map(g => {
              const checked = selectedGoals.has(g);
              return (
                <label
                  key={g}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-all select-none min-h-[44px] ${
                    loading || isCloning || rerunPulling
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-elevated'
                  } ${checked ? 'text-label' : 'text-tertiary-label'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selectedGoals);
                      if (checked) next.delete(g);
                      else next.add(g);
                      setSelectedGoals(next);
                    }}
                    disabled={loading || isCloning || rerunPulling}
                    className="accent-[var(--color-tint)] w-3.5 h-3.5 rounded cursor-pointer"
                  />
                  {GOAL_LABELS[g] ?? g}
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-tertiary-label mt-1.5">
            {selectedGoals.size === 0
              ? 'Select at least one goal'
              : selectedGoals.size === ALL_GOALS.length
                ? `All ${ALL_GOALS.length} goals selected`
                : `${selectedGoals.size} of ${ALL_GOALS.length} goals selected`}
          </p>
        </div>
      )}
    </div>
  );

  // ─── Budget picker section ──────────────────────────────────────

  const BUDGET_PRESETS = [
    { label: 'Default', value: null as number | null },
    { label: '30', value: 30 },
    { label: '60', value: 60 },
    { label: '100', value: 100 },
  ];

  const isMultiGoal = selectedGoals.size > 1;
  const defaultBudget = isMultiGoal ? 30 : 45;
  const budgetDisplay = budget ?? defaultBudget;

  const budgetPickerContent = (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-secondary-label">
          Tool Budget
        </label>
        <span className="text-[11px] text-tertiary-label">
          {budget == null ? `${defaultBudget} calls (default)` : `${budget} calls`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {BUDGET_PRESETS.map(preset => {
          const isActive = budget === preset.value;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => setBudget(preset.value)}
              disabled={loading || isCloning || rerunPulling}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer min-h-[44px] ${
                isActive
                  ? 'bg-tint text-white'
                  : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <input
          type="number"
          min={10}
          max={500}
          value={budgetDisplay}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= 10) setBudget(v);
          }}
          disabled={loading || isCloning || rerunPulling}
          className="w-16 h-[44px] bg-elevated rounded-md px-2 text-[12px] text-label font-mono text-center border border-transparent focus:border-tint-focus focus:ring-2 focus:ring-tint-soft focus:outline-none transition-all"
        />
      </div>
    </div>
  );

  // ─── Shared form fields ────────────────────────────────────────

  const formContent = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="repo-input" className="block text-xs font-medium text-secondary-label mb-1.5">
          Repository
        </label>
        <input
          id="repo-input"
          type="text"
          value={displayName || repoPath}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => {
            if (displayName) {
              setDisplayName('');
            }
          }}
          onBlur={handleInputBlur}
          placeholder="https://github.com/org/repo or /path/to/repo"
          className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label font-mono placeholder:text-quaternary-label border border-transparent focus:border-tint-focus focus:ring-2 focus:ring-tint-soft focus:outline-none focus:focus-glow transition-all"
          disabled={loading || isCloning || rerunPulling}
        />
        {displayName && repoPath !== displayName && (
          <p className="text-[11px] text-quaternary-label font-mono mt-1 truncate">{repoPath}</p>
        )}
      </div>

      {/* Clone success banner */}
      {isCloned && (
        <div className="flex items-center gap-2 bg-success-subtle rounded-lg px-3 py-2.5 border border-[color-mix(in_srgb,var(--color-success)_15%,transparent)]">
          <svg className="w-4 h-4 text-success shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-xs text-secondary-label flex-1">
            <span className="font-medium text-label">{clonedRepoName}</span>
            {clonedCached ? ' ready from cache' : ' pulled successfully'}
          </span>
          {clonedCached && (
            <button
              type="button"
              onClick={handleClone}
              className="text-[11px] text-tint hover:underline cursor-pointer shrink-0 min-h-[44px] flex items-center"
            >
              Pull latest
            </button>
          )}
        </div>
      )}

      {/* Monorepo root picker */}
      {detectingRoots && (
        <div className="flex items-center gap-2 px-1 py-1">
          <StaggeredSpinner size={14} />
          <span className="text-xs text-tertiary-label">Detecting app roots...</span>
        </div>
      )}
      {!detectingRoots && isMonorepo && detectedRoots.length > 1 && (
        <div>
          <label htmlFor="root-select" className="block text-xs font-medium text-secondary-label mb-1.5">
            App Root
            <span className="ml-1.5 text-tertiary-label font-normal">
              {detectedRoots.length} roots detected{monorepoTool ? ` (${monorepoTool})` : ''}
            </span>
          </label>
          <Select
            value={selectedRoot}
            onValueChange={(v) => setSelectedRoot(v ?? '__entire__')}
            disabled={loading || isCloning || rerunPulling}
          >
            <SelectTrigger
              className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label border border-transparent focus:border-tint-focus focus:ring-2 focus:ring-tint-soft"
            >
              <SelectValue placeholder="Entire repository" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--color-surface)] border-[var(--color-separator)]">
              <SelectItem value="__entire__">Entire repository</SelectItem>
              {detectedRoots.map(root => (
                <SelectItem key={root.path} value={root.path}>
                  {root.path}
                  {root.framework ? ` — ${root.framework}${root.frameworkVersion ? ` ${root.frameworkVersion}` : ''}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {effectiveRoot && (
            <p className="text-[11px] text-tertiary-label mt-1.5">
              Analysis will be scoped to <span className="font-mono text-secondary-label">{effectiveRoot}</span>
            </p>
          )}
        </div>
      )}

      {goalPickerContent}

      {budgetPickerContent}

      {/* Parallel workers toggle — only visible for multi-goal */}
      {isMultiGoal && (
        <label
          className={`flex items-center gap-2.5 px-1 select-none min-h-[44px] ${
            loading || isCloning || rerunPulling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={parallel}
            onChange={() => setParallel(v => !v)}
            disabled={loading || isCloning || rerunPulling}
            className="accent-[var(--color-tint)] w-3.5 h-3.5 rounded cursor-pointer"
          />
          <span className="text-[12px] text-secondary-label">
            Parallel workers
          </span>
          <span className="text-[11px] text-quaternary-label">
            Run cluster workers concurrently instead of 3 sequential passes
          </span>
        </label>
      )}

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      <button
        type="submit"
        disabled={buttonDisabled}
        className={`rounded-lg h-11 px-5 text-sm font-medium transition-all mt-1 ${
          buttonDisabled
            ? 'bg-elevated text-tertiary-label cursor-not-allowed'
            : 'bg-tint text-white cursor-pointer hover:brightness-110 active:scale-[0.98]'
        }`}
      >
        {buttonLabel}
      </button>
    </form>
  );

  // ─── Compact mode (modal overlay) ──────────────────────────────

  if (compact) {
    return (
      <div data-component="IdleView" className="bg-surface rounded-xl border border-separator shadow-sm p-6 w-full max-w-lg">
        <h2 className="text-lg font-bold text-label tracking-tight mb-1">New Analysis</h2>
        <p className="text-sm text-secondary-label mb-5">
          Point at a codebase to start a new run.
        </p>
        {formContent}
      </div>
    );
  }

  // ─── Dense run row component ───────────────────────────────────

  const RunRow = ({ run, onClick }: { run: HistoryRunItem; onClick: () => void }) => {
    const repoLabel = run.repoSource === 'github' && run.repoUrl
      ? run.repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
      : run.repoName;
    const goalLabel = run.goal === 'all' ? 'Full audit' : run.goal;
    const when = run.completedAt ? relativeTime(run.completedAt) : relativeTime(run.startedAt);
    const isSelected = selectedHistoryId === (run.parentRunId ?? run.id);

    return (
      <button
        data-run-row
        type="button"
        onClick={onClick}
        className={`flex items-center gap-3 w-full text-left px-3 h-10 min-h-[44px] rounded-lg transition-all cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus focus-visible:focus-glow ${
          isSelected
            ? 'bg-tint-hover border border-tint-subtle'
            : 'hover:bg-elevated border border-transparent'
        }`}
        tabIndex={0}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${scoreColor(run.score)}`} />
        <span className="text-sm text-label font-medium truncate flex-1 min-w-0">{repoLabel}</span>
        <span className="text-[11px] text-tertiary-label shrink-0">{goalLabel}</span>
        {run.findingsCount != null && run.findingsCount > 0 && (
          <span className="text-[11px] text-quaternary-label shrink-0 font-mono">{run.findingsCount}f</span>
        )}
        <span className="text-[11px] text-quaternary-label shrink-0 w-14 text-right">{when}</span>
        <svg className="w-3.5 h-3.5 text-quaternary-label group-hover:text-tint shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  };

  // ─── First-time user view ─────────────────────────────────────

  if (isFirstTime) {
    return (
      <div data-component="IdleView" className="flex-1 overflow-y-auto">
        <div className="px-6 pt-10 pb-8 animate-slide-up">
          <h1 className="text-[32px] font-bold font-brand text-label tracking-[-0.02em] mb-2">
            Radar
          </h1>
          <p className="text-[15px] text-secondary-label mb-8 max-w-[420px]">
            Point at a codebase. Get a scored report on architecture, security, dependencies, and delivery risk.
          </p>
          <div className="max-w-lg">
            {formContent}
          </div>
        </div>

        {/* Cached repos (if any) */}
        {!cachedReposReady && !loading && (
          <CachedReposLoadingSkeleton />
        )}
        {cachedReposReady && cachedRepos.length > 0 && !loading && (
          <div className="px-6 pb-6 animate-slide-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-[13px] font-semibold text-label mb-2">Previously Pulled</h2>
            <div className="flex flex-wrap gap-1.5">
              {cachedRepos.map(r => (
                <button
                  key={r.localPath}
                  type="button"
                  onClick={() => handleSelectCached(r)}
                  className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-elevated text-[12px] text-secondary-label hover:text-label hover:bg-tint-hover border border-transparent hover:border-tint-subtle transition-all cursor-pointer min-h-[44px]"
                >
                  <svg className="w-3 h-3 text-tertiary-label shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z" />
                  </svg>
                  {r.owner}/{r.repo}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Returning user view (data-first) ─────────────────────────

  return (
    <div data-component="IdleView" className="flex-1 overflow-y-auto">
      {/* Portfolio metrics row */}
      <div className="px-6 pt-6 pb-4 animate-slide-up">
        <div className="grid grid-cols-2 sm:flex sm:items-baseline gap-x-8 gap-y-3">
          <div>
            <div className="text-[24px] font-bold font-brand text-label tracking-tight">
              {metrics.repos || '—'}
            </div>
            <div className="text-[11px] text-tertiary-label mt-0.5">repos analyzed</div>
          </div>
          <div>
            <div className="text-[24px] font-bold font-brand text-label tracking-tight">
              {metrics.runs || '—'}
            </div>
            <div className="text-[11px] text-tertiary-label mt-0.5">runs completed</div>
          </div>
          <div>
            <div className="text-[24px] font-bold font-brand text-label tracking-tight">
              {metrics.findings || '0'}
            </div>
            <div className="text-[11px] text-tertiary-label mt-0.5">findings</div>
          </div>
          {metrics.criticals > 0 && (
            <div>
              <div className="text-[24px] font-bold font-brand text-danger tracking-tight">
                {metrics.criticals}
              </div>
              <div className="text-[11px] text-tertiary-label mt-0.5">critical</div>
            </div>
          )}
          <div>
            <div className="text-[13px] font-medium text-secondary-label">
              {metrics.lastRun}
            </div>
            <div className="text-[11px] text-tertiary-label mt-0.5">last run</div>
          </div>
        </div>
      </div>

      {/* Compact form */}
      <div className="px-6 pb-5" style={{ animationDelay: '50ms' }}>
        <div className="max-w-lg">
          {formContent}
        </div>
      </div>

      {/* Previously pulled repos as badge pills */}
      {!cachedReposReady && !loading && (
        <CachedReposLoadingSkeleton />
      )}
      {cachedReposReady && cachedRepos.length > 0 && !loading && (
        <div className="px-6 pb-4 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-[13px] font-semibold text-label mb-2">Previously Pulled</h2>
          <div className="flex flex-wrap gap-1.5">
            {(showAllCached ? cachedRepos : cachedRepos.slice(0, 6)).map(r => {
              const isSelected = repoPath === `https://github.com/${r.owner}/${r.repo}`;
              return (
                <button
                  key={r.localPath}
                  type="button"
                  onClick={() => handleSelectCached(r)}
                  className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] transition-all cursor-pointer min-h-[44px] ${
                    isSelected
                      ? 'bg-tint-hover text-label border border-tint-subtle'
                      : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover border border-transparent hover:border-tint-subtle'
                  }`}
                >
                  <svg className="w-3 h-3 text-tertiary-label shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z" />
                  </svg>
                  {r.owner}/{r.repo}
                </button>
              );
            })}
            {cachedRepos.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllCached(v => !v)}
                className="text-[11px] text-tertiary-label hover:text-secondary-label transition-colors cursor-pointer min-h-[44px] flex items-center px-1"
              >
                {showAllCached ? 'Show less' : `+${cachedRepos.length - 6} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Recent runs — dense list */}
      {!historyReady && !loading && (
        <HistoryLoadingSkeleton />
      )}
      {historyReady && deduplicatedHistory.length > 0 && !loading && (
        <div className="px-6 pb-8 animate-slide-up" style={{ animationDelay: '150ms' }}>
          <h2 className="text-[13px] font-semibold text-label mb-2">Recent Runs</h2>
          <div
            ref={runListRef}
            onKeyDown={handleRunListKeyDown}
            className="flex flex-col gap-0.5"
            role="list"
          >
            {(showAllHistory ? deduplicatedHistory : deduplicatedHistory.slice(0, 5)).map(run => (
              <RunRow
                key={run.parentRunId ?? run.id}
                run={run}
                onClick={() => handleSelectHistoryRun(run)}
              />
            ))}
          </div>
          {deduplicatedHistory.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllHistory(v => !v)}
              className="mt-2 text-[12px] text-tertiary-label hover:text-secondary-label transition-colors cursor-pointer min-h-[44px] flex items-center"
            >
              {showAllHistory ? 'Show less' : `View all ${deduplicatedHistory.length} runs →`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
