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
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 40,
        width: '100%',
        maxWidth: 520,
      }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          marginBottom: 8,
          color: 'var(--text-primary)',
        }}>
          Start Investigation
        </h1>
        <p style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 28,
        }}>
          Analyze a headless CMS codebase with the AI agent.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 6,
              fontWeight: 500,
            }}>
              Repository Path
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              placeholder="/path/to/your/repo or C:\..."
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '8px 12px',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
              disabled={loading}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 6,
              fontWeight: 500,
            }}>
              Goal
            </label>
            <select
              value={goal}
              onChange={e => setGoal(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '8px 12px',
                fontSize: 13,
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="onboarding">Onboarding — full codebase overview</option>
              <option value="security-review">Security Review — focus on vulnerabilities</option>
              <option value="audit">Audit — deep quality analysis</option>
              <option value="migration">Migration — upgrade path assessment</option>
            </select>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: 'var(--error)' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? 'var(--bg-elevated)' : 'var(--accent)',
              color: loading ? 'var(--text-muted)' : '#000',
              border: 'none',
              borderRadius: 4,
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 8,
            }}
          >
            {loading ? 'Starting...' : 'Start Investigation'}
          </button>
        </form>
      </div>
    </div>
  );
}
