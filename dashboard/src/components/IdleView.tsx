'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { StaggeredSpinner, HistoryLoadingSkeleton, CachedReposLoadingSkeleton } from '@/components/Skeleton';

interface HistoryRunItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
  findingsCount?: number;
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
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
  onStart: (repoPath: string, goal: string, repoName?: string, appRoot?: string, runId?: string) => void;
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
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

export function IdleView({ initialRepoPath = '', onStart, history = [], historyReady = true, compact = false }: IdleViewProps) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [goal, setGoal] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Clone state for GitHub URLs
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'cloning' | 'cloned'>('idle');
  const [clonedPath, setClonedPath] = useState('');
  const [clonedRepoName, setClonedRepoName] = useState('');
  const [clonedCached, setClonedCached] = useState(false);

  // Cached repos from .repos/
  const [cachedRepos, setCachedRepos] = useState<CachedRepo[]>([]);
  const [cachedReposReady, setCachedReposReady] = useState(false);
  const [showAllCached, setShowAllCached] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Pulling state for rerun (auto-pull git repos)
  const [rerunPulling, setRerunPulling] = useState(false);

  // Monorepo root detection
  const [detectedRoots, setDetectedRoots] = useState<AppRoot[]>([]);
  const [isMonorepo, setIsMonorepo] = useState(false);
  const [monorepoTool, setMonorepoTool] = useState<string | undefined>();
  const [selectedRoot, setSelectedRoot] = useState<string>(''); // '' = entire repo
  const [detectingRoots, setDetectingRoots] = useState(false);

  const isUrl = isGitHubUrl(repoPath);
  const isCloned = cloneStatus === 'cloned';
  const isCloning = cloneStatus === 'cloning';

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
      setSelectedRoot(''); // default to entire repo
    } catch { /* ignore detection failures */ }
    finally { setDetectingRoots(false); }
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setRepoPath(value);
    setError('');
    // Reset clone state when the URL changes
    if (cloneStatus !== 'idle') {
      setCloneStatus('idle');
      setClonedPath('');
      setClonedRepoName('');
      setClonedCached(false);
      setDetectedRoots([]);
      setIsMonorepo(false);
      setSelectedRoot('');
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
    setClonedPath(repo.localPath);
    setClonedRepoName(repo.repo);
    setClonedCached(true);
    setCloneStatus('cloned');
    setError('');
    detectRoots(repo.localPath);
  }, [detectRoots]);

  const handleSelectHistoryRun = useCallback(async (run: HistoryRunItem) => {
    setError('');

    // Set the goal from the historical run
    setGoal(run.goal);

    if (run.repoSource === 'github' && run.repoUrl) {
      // GitHub repo: set URL, auto-pull latest
      setRepoPath(run.repoUrl);
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
      // Local repo: just pre-fill the path
      setRepoPath(run.repoPath);
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
    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoPath.trim() }),
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
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: targetPath,
          goal,
          ...(isCloned ? { repoSource: 'github', repoUrl: repoPath.trim() } : {}),
          ...(selectedRoot ? { appRoot: selectedRoot } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start run');
        setLoading(false);
        return;
      }
      onStart(targetPath, goal, isCloned ? clonedRepoName : undefined, selectedRoot || undefined, data.runId);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  // Determine button label and state
  let buttonLabel: string;
  let buttonDisabled: boolean;
  if (isCloning || rerunPulling) {
    buttonLabel = 'Pulling...';
    buttonDisabled = true;
  } else if (isCloned) {
    buttonLabel = loading ? 'Starting...' : 'Start Analysis';
    buttonDisabled = loading;
  } else if (isUrl) {
    buttonLabel = 'Pull Repo';
    buttonDisabled = false;
  } else {
    buttonLabel = loading ? 'Starting...' : 'Start Analysis';
    buttonDisabled = loading;
  }

  // Stat bar data (for full-page hero)
  const stats = useMemo(() => {
    const completedRuns = history.filter(r => r.completedAt);
    return [
      { value: '23', label: 'analysis tools' },
      { value: '8', label: 'goal scorecards' },
      { value: String(completedRuns.length), label: 'runs completed' },
    ];
  }, [history]);

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
          value={repoPath}
          onChange={e => handleInputChange(e.target.value)}
          onBlur={handleInputBlur}
          placeholder="https://github.com/org/repo or /path/to/repo"
          className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label font-mono placeholder:text-quaternary-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none focus:focus-glow transition-all"
          disabled={loading || isCloning || rerunPulling}
        />
      </div>

      {/* Clone success banner */}
      {isCloned && (
        <div className="flex items-center gap-2 bg-[rgb(52_199_89/0.08)] rounded-lg px-3 py-2.5 border border-[rgb(52_199_89/0.15)]">
          <svg className="w-4 h-4 text-[rgb(52_199_89)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className="text-[11px] text-tint hover:underline cursor-pointer shrink-0"
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
          <select
            id="root-select"
            value={selectedRoot}
            onChange={e => setSelectedRoot(e.target.value)}
            disabled={loading || isCloning || rerunPulling}
            className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none cursor-pointer"
          >
            <option value="">Entire repository</option>
            {detectedRoots.map(root => (
              <option key={root.path} value={root.path}>
                {root.path}
                {root.framework ? ` — ${root.framework}${root.frameworkVersion ? ` ${root.frameworkVersion}` : ''}` : ''}
              </option>
            ))}
          </select>
          {selectedRoot && (
            <p className="text-[11px] text-tertiary-label mt-1.5">
              Analysis will be scoped to <span className="font-mono text-secondary-label">{selectedRoot}</span>
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="goal-select" className="block text-xs font-medium text-secondary-label mb-1.5">
          Goal
        </label>
        <select
          id="goal-select"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          disabled={loading || isCloning || rerunPulling}
          className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none cursor-pointer"
        >
          <option value="all">All Goals — universal analysis (8 scorecards)</option>
          <option value="onboarding">Onboarding — full codebase overview</option>
          <option value="security-review">Security Review — focus on vulnerabilities</option>
          <option value="audit">Audit — deep quality analysis</option>
          <option value="audit-generic">Generic Audit — any stack, no CMS required</option>
          <option value="migration">Migration — upgrade path assessment</option>
          <option value="nextjs">Next.js Audit — framework health &amp; patterns</option>
          <option value="accessibility">Accessibility — WCAG 2.1 AA compliance</option>
        </select>
        {goal === 'all' && (
          <p className="text-[11px] text-tertiary-label mt-1.5">
            Runs all 8 goal scorecards in sequence. Takes longer but gives the complete picture.
          </p>
        )}
      </div>

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
      <div className="bg-surface rounded-xl border border-separator shadow-sm p-6 w-full max-w-lg">
        <h2 className="text-lg font-bold text-label tracking-tight mb-1">New Analysis</h2>
        <p className="text-sm text-secondary-label mb-5">
          Point at a codebase to start a new run.
        </p>
        {formContent}
      </div>
    );
  }

  // ─── Full-page hero layout ─────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stat bar hero */}
      <div className="px-6 pt-8 pb-6 animate-slide-up">
        <h1 className="text-[32px] font-bold font-brand text-label tracking-[-0.02em] mb-1">
          Radar
        </h1>
        <p className="text-[15px] text-secondary-label mb-6 max-w-[480px]">
          Point at a codebase. The agent analyzes architecture, security, dependencies, and delivery risk, then writes a scored report.
        </p>
        <div className="flex items-baseline gap-8">
          {stats.map(stat => (
            <div key={stat.label}>
              <div className="text-[24px] font-bold font-brand text-label tracking-tight">
                {stat.value}
              </div>
              <div className="text-[11px] text-tertiary-label mt-0.5">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Form section */}
      <div className="px-6 pb-6" style={{ animationDelay: '50ms' }}>
        <div className="max-w-lg">
          {formContent}
        </div>
      </div>

      {/* Cached repos — skeleton while loading */}
      {!cachedReposReady && !isCloned && !isCloning && !loading && (
        <CachedReposLoadingSkeleton />
      )}
      {cachedReposReady && cachedRepos.length > 0 && !isCloned && !isCloning && !loading && (
        <div className="px-6 pb-6 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-[13px] font-semibold text-label mb-3">Previously Pulled</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(showAllCached ? cachedRepos : cachedRepos.slice(0, 3)).map(r => (
              <button
                key={r.localPath}
                type="button"
                onClick={() => handleSelectCached(r)}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 min-h-touch rounded-lg bg-elevated hover:bg-[rgb(0_113_227/0.06)] border border-transparent hover:border-[rgb(0_113_227/0.15)] transition-all cursor-pointer group"
              >
                <svg className="w-4 h-4 text-tertiary-label group-hover:text-tint shrink-0 transition-colors" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-label font-medium truncate">
                    {r.owner}/{r.repo}
                  </div>
                  <div className="text-[11px] text-quaternary-label font-mono truncate">
                    {r.defaultBranch} &middot; {r.lastCommit.hash.slice(0, 7)} &middot; {new Date(r.lastCommit.date).toLocaleDateString()}
                  </div>
                </div>
                <svg className="w-3.5 h-3.5 text-quaternary-label group-hover:text-tint shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
          {cachedRepos.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllCached(v => !v)}
              className="mt-2 text-[12px] text-tertiary-label hover:text-secondary-label transition-colors cursor-pointer"
            >
              {showAllCached ? 'Show less' : `${cachedRepos.length - 3} more...`}
            </button>
          )}
        </div>
      )}

      {/* Recent runs — skeleton while loading, real cards once ready */}
      {!historyReady && !isCloned && !isCloning && !loading && !rerunPulling && (
        <HistoryLoadingSkeleton />
      )}
      {historyReady && history.length > 0 && !isCloned && !isCloning && !loading && !rerunPulling && (
        <div className="px-6 pb-8 animate-slide-up" style={{ animationDelay: '150ms' }}>
          <h2 className="text-[13px] font-semibold text-label mb-3">Recent Runs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(showAllHistory ? history : history.slice(0, 3)).map(run => (
              <button
                key={run.id}
                type="button"
                onClick={() => handleSelectHistoryRun(run)}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 min-h-touch rounded-lg bg-elevated hover:bg-[rgb(0_113_227/0.06)] border border-transparent hover:border-[rgb(0_113_227/0.15)] transition-all cursor-pointer group"
              >
                <svg className="w-4 h-4 text-tertiary-label group-hover:text-tint shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-label font-medium truncate">
                    {run.repoName}
                    <span className="ml-1.5 text-[11px] text-tertiary-label font-normal">{run.goal}</span>
                  </div>
                  <div className="text-[11px] text-quaternary-label truncate">
                    {run.completedAt ? new Date(run.completedAt).toLocaleDateString() : new Date(run.startedAt).toLocaleDateString()}
                    {run.repoSource === 'github' && <span className="ml-1 text-tint/60">git</span>}
                  </div>
                </div>
                <svg className="w-3.5 h-3.5 text-quaternary-label group-hover:text-tint shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
          {history.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllHistory(v => !v)}
              className="mt-2 text-[12px] text-tertiary-label hover:text-secondary-label transition-colors cursor-pointer"
            >
              {showAllHistory ? 'Show less' : `${history.length - 3} more...`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
