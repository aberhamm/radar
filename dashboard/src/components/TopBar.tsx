'use client';

import type { SessionStatus } from '@/lib/agentSession';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';

interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
}

interface TopBarProps {
  status: SessionStatus;
  repoName?: string;
  goal?: string;
  toolCalls?: number;
  budget?: number;
  scorecard?: Scorecard;
  metrics?: RunMetrics;
  history: HistoryItem[];
  onNewRun: () => void;
  onSelectHistory: (id: string) => void;
}

function ScoreDot({ score }: { score: 'red' | 'yellow' | 'green' }) {
  const colors = { red: '#f85149', yellow: '#e3b341', green: '#3fb950' };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[score],
        marginRight: 4,
      }}
    />
  );
}

export function TopBar({ status, repoName, goal, toolCalls, budget, scorecard, history, onNewRun, onSelectHistory }: TopBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';

  return (
    <header style={{
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      padding: '0 20px',
      height: 48,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 10,
      flexShrink: 0,
    }}>
      {/* Brand */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--accent)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        repo-audit-agent
      </span>

      {/* Center: repo + goal badges */}
      {(isRunning || isComplete) && repoName && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <span style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
          }}>
            {repoName}
          </span>
          {goal && (
            <span style={{
              background: 'rgba(88,166,255,0.1)',
              border: '1px solid rgba(88,166,255,0.3)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              color: 'var(--accent)',
            }}>
              {goal}
            </span>
          )}
          {scorecard && (
            <span style={{ fontSize: 12, display: 'flex', alignItems: 'center' }}>
              <ScoreDot score={scorecard.overallScore} />
              <span style={{ color: 'var(--text-secondary)' }}>{scorecard.overallScore.toUpperCase()}</span>
            </span>
          )}
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Budget progress bar */}
        {isRunning && budget && toolCalls !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {toolCalls} / {budget}
            </span>
            <div style={{
              width: 80,
              height: 4,
              background: 'var(--bg-elevated)',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(100, (toolCalls / budget) * 100)}%`,
                height: '100%',
                background: toolCalls / budget > 0.8 ? 'var(--error)' : toolCalls / budget > 0.6 ? 'var(--warning)' : 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {/* History dropdown */}
        {history.length > 0 && (
          <select
            onChange={e => { if (e.target.value) onSelectHistory(e.target.value); }}
            defaultValue=""
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <option value="" disabled>History</option>
            {history.map(h => (
              <option key={h.id} value={h.id}>
                {h.repoName} ({h.goal})
              </option>
            ))}
          </select>
        )}

        {/* New Run button */}
        {isComplete && (
          <button
            onClick={onNewRun}
            style={{
              background: 'var(--accent)',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            New Run
          </button>
        )}
      </div>
    </header>
  );
}
