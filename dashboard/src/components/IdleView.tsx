'use client';

import { useState, useCallback, useEffect } from 'react';

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

interface IdleViewProps {
  initialRepoPath?: string;
  onStart: (repoPath: string, goal: string, repoName?: string) => void;
  history?: HistoryRunItem[];
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

export function IdleView({ initialRepoPath = '', onStart, history = [] }: IdleViewProps) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [goal, setGoal] = useState('onboarding');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Clone state for GitHub URLs
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'cloning' | 'cloned'>('idle');
  const [clonedPath, setClonedPath] = useState('');
  const [clonedRepoName, setClonedRepoName] = useState('');
  const [clonedCached, setClonedCached] = useState(false);

  // Cached repos from .repos/
  const [cachedRepos, setCachedRepos] = useState<CachedRepo[]>([]);

  // Pulling state for rerun (auto-pull git repos)
  const [rerunPulling, setRerunPulling] = useState(false);

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
      .catch(() => { /* ignore */ });
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
    }
  }, [cloneStatus]);

  const handleSelectCached = useCallback((repo: CachedRepo) => {
    setRepoPath(`https://github.com/${repo.owner}/${repo.repo}`);
    setClonedPath(repo.localPath);
    setClonedRepoName(repo.repo);
    setClonedCached(true);
    setCloneStatus('cloned');
    setError('');
  }, []);

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
    }
  }, []);

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
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to start run');
        setLoading(false);
        return;
      }
      onStart(targetPath, goal, isCloned ? clonedRepoName : undefined);
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

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-surface rounded-xl border border-separator shadow-sm p-6 w-full max-w-lg">
        <svg className="w-8 h-8 mb-4 text-tint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
          <path d="M11 8v6M8 11h6" />
        </svg>
        <h1 className="text-xl font-bold text-label tracking-tight mb-1">
          Start Analysis
        </h1>
        <p className="text-sm text-secondary-label mb-6">
          Point at a codebase. The agent analyzes architecture, security, dependencies, and delivery risk, then writes a scored report.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-secondary-label mb-1.5">
              Repository
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={e => handleInputChange(e.target.value)}
              placeholder="https://github.com/org/repo or /path/to/repo"
              className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label font-mono placeholder:text-quaternary-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none focus:focus-glow transition-all"
              disabled={loading || isCloning || rerunPulling}
            />
          </div>

          {/* Previous runs picker */}
          {history.length > 0 && !isCloned && !isCloning && !loading && !rerunPulling && (
            <div>
              <label className="block text-xs font-medium text-secondary-label mb-1.5">
                Rerun Previous
              </label>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {history.map(run => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => handleSelectHistoryRun(run)}
                    className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg bg-elevated hover:bg-[rgb(0_113_227/0.06)] border border-transparent hover:border-[rgb(0_113_227/0.15)] transition-all cursor-pointer group"
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
            </div>
          )}

          {/* Cached repos picker */}
          {cachedRepos.length > 0 && !isCloned && !isCloning && !loading && (
            <div>
              <label className="block text-xs font-medium text-secondary-label mb-1.5">
                Previously Pulled
              </label>
              <div className="flex flex-col gap-1">
                {cachedRepos.map(r => (
                  <button
                    key={r.localPath}
                    type="button"
                    onClick={() => handleSelectCached(r)}
                    className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg bg-elevated hover:bg-[rgb(0_113_227/0.06)] border border-transparent hover:border-[rgb(0_113_227/0.15)] transition-all cursor-pointer group"
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
            </div>
          )}

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

          <div>
            <label className="block text-xs font-medium text-secondary-label mb-1.5">
              Goal
            </label>
            <select
              value={goal}
              onChange={e => setGoal(e.target.value)}
              disabled={loading || isCloning || rerunPulling}
              className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none cursor-pointer"
            >
              <option value="onboarding">Onboarding — full codebase overview</option>
              <option value="security-review">Security Review — focus on vulnerabilities</option>
              <option value="audit">Audit — deep quality analysis</option>
              <option value="migration">Migration — upgrade path assessment</option>
              <option value="nextjs">Next.js Audit — framework health &amp; patterns</option>
              <option value="accessibility">Accessibility — WCAG 2.1 AA compliance</option>
              <option value="all">All Goals — universal analysis (8 scorecards)</option>
            </select>
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
                : 'bg-tint text-white cursor-pointer hover:bg-[#0077ed] active:scale-[0.98]'
            }`}
          >
            {buttonLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
