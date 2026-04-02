'use client';

import { useState } from 'react';

interface IdleViewProps {
  initialRepoPath?: string;
  onStart: (repoPath: string, goal: string) => void;
}

export function IdleView({ initialRepoPath = '', onStart }: IdleViewProps) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [goal, setGoal] = useState('onboarding');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) {
      setError('Repo path is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repoPath.trim(), goal }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to start run');
        setLoading(false);
        return;
      }
      onStart(repoPath.trim(), goal);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-surface rounded-xl border border-separator shadow-sm p-6 w-full max-w-lg">
        <svg className="w-8 h-8 mb-4 text-tint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
          <path d="M11 8v6M8 11h6" />
        </svg>
        <h1 className="text-xl font-bold text-label tracking-tight mb-1">
          Start Investigation
        </h1>
        <p className="text-sm text-secondary-label mb-6">
          Point at a headless CMS codebase. The agent investigates architecture, security, dependencies, and delivery risk, then writes a scored report.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-secondary-label mb-1.5">
              Repository Path
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              placeholder="/path/to/your/repo or C:\..."
              className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label font-mono placeholder:text-quaternary-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none focus:focus-glow transition-all"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary-label mb-1.5">
              Goal
            </label>
            <select
              value={goal}
              onChange={e => setGoal(e.target.value)}
              disabled={loading}
              className="w-full h-11 bg-elevated rounded-lg px-3 text-sm text-label border border-transparent focus:border-[rgb(0_113_227/0.3)] focus:ring-2 focus:ring-[rgb(0_113_227/0.1)] focus:outline-none cursor-pointer"
            >
              <option value="onboarding">Onboarding — full codebase overview</option>
              <option value="security-review">Security Review — focus on vulnerabilities</option>
              <option value="audit">Audit — deep quality analysis</option>
              <option value="migration">Migration — upgrade path assessment</option>
            </select>
          </div>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`rounded-lg h-11 px-5 text-sm font-medium transition-all mt-1 ${
              loading
                ? 'bg-elevated text-tertiary-label cursor-not-allowed'
                : 'bg-tint text-white cursor-pointer hover:bg-[#0077ed] active:scale-[0.98]'
            }`}
          >
            {loading ? 'Starting...' : 'Start Investigation'}
          </button>
        </form>
      </div>
    </div>
  );
}
