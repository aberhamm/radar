'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Scorecard, RunMetrics, CategoryScore } from '@agent/types/output.js';
import type { StepEvent } from '@agent/agent/runner.js';
import { EventStream } from './EventStream';

interface CompleteViewProps {
  briefMarkdown: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  events: StepEvent[];
  goal: string;
}

type Tab = 'report' | 'events' | 'rules' | 'cost';

function scoreColor(score: 'red' | 'yellow' | 'green'): string {
  return score === 'red' ? '#f85149' : score === 'yellow' ? '#e3b341' : '#3fb950';
}

function ScorecardGrid({ scorecard }: { scorecard: Scorecard }) {
  return (
    <div style={{ marginBottom: 24 }}>
      {/* Overall score */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        padding: '12px 16px',
        background: 'var(--bg-elevated)',
        borderRadius: 6,
        border: `1px solid ${scoreColor(scorecard.overallScore)}40`,
      }}>
        <div style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: scoreColor(scorecard.overallScore),
          flexShrink: 0,
        }} />
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            Overall: {scorecard.overallScore.toUpperCase()}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 12 }}>
            {scorecard.repoName} · {scorecard.goalType}
          </span>
        </div>
      </div>

      {/* Category grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 8,
      }}>
        {scorecard.categories.map((cat: CategoryScore) => (
          <div key={cat.category} style={{
            background: 'var(--bg-elevated)',
            border: `1px solid ${scoreColor(cat.score)}30`,
            borderLeft: `3px solid ${scoreColor(cat.score)}`,
            borderRadius: 4,
            padding: '8px 12px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {cat.category}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: scoreColor(cat.score), fontWeight: 600 }}>
                {cat.score.toUpperCase()}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {cat.findings.length} findings
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Top risks */}
      {scorecard.topRisks.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Top Risks
          </div>
          {scorecard.topRisks.slice(0, 3).map(risk => (
            <div key={risk.id} style={{
              padding: '6px 12px',
              borderLeft: '3px solid var(--error)',
              background: 'var(--bg-elevated)',
              marginBottom: 4,
              borderRadius: '0 4px 4px 0',
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--error)', fontWeight: 600, marginRight: 8 }}>
                [{risk.severity.toUpperCase()}]
              </span>
              {risk.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CostTab({ metrics }: { metrics: RunMetrics }) {
  const durationS = (metrics.durationMs / 1000).toFixed(1);
  const modelEntries = Object.entries(metrics.models);

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Summary row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        {[
          { label: 'Total Cost', value: `$${metrics.totalEstimatedCostUsd.toFixed(4)}`, accent: true },
          { label: 'Duration', value: `${durationS}s` },
          { label: 'Tool Calls', value: String(metrics.toolCalls) },
          { label: 'Models Used', value: String(modelEntries.length) },
        ].map(item => (
          <div key={item.label} style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 16px',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              {item.label}
            </div>
            <div style={{
              fontSize: 20,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: item.accent ? 'var(--accent)' : 'var(--text-primary)',
            }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-model table */}
      <div style={{ fontSize: 12 }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Model Breakdown
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)' }}>
                {['Model', 'Calls', 'Input', 'Output', 'Cached', 'Cost'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelEntries.map(([modelId, info]) => (
                <tr key={modelId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {modelId.replace('us.anthropic.', '')}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{info.calls}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{info.inputTokens.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{info.outputTokens.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{info.cachedTokens.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--success)' }}>${info.estimatedCostUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RulesTab({ goal }: { goal: string }) {
  const [rules, setRules] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/rules?goal=${encodeURIComponent(goal)}`)
      .then(r => r.json())
      .then(data => {
        setRules(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [goal]);

  if (loading) {
    return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading rules...</div>;
  }

  if (Object.keys(rules).length === 0) {
    return <div style={{ padding: 20, color: 'var(--text-muted)' }}>No rules found for goal: {goal}</div>;
  }

  return (
    <div style={{ padding: '20px 0' }}>
      {Object.entries(rules).map(([filename, content]) => (
        <div key={filename} style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            marginBottom: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            {filename}
          </div>
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 16,
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
          }}>
            {content}
          </div>
        </div>
      ))}
    </div>
  );
}

const markdownStyles = `
  .md-content h1, .md-content h2, .md-content h3 { color: var(--text-primary); margin: 1.2em 0 0.5em; }
  .md-content h1 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .md-content h2 { font-size: 1.2em; }
  .md-content h3 { font-size: 1em; }
  .md-content p { color: var(--text-secondary); margin: 0.6em 0; line-height: 1.7; }
  .md-content ul, .md-content ol { color: var(--text-secondary); margin: 0.5em 0 0.5em 1.5em; }
  .md-content li { margin: 0.2em 0; line-height: 1.6; }
  .md-content code { font-family: var(--font-mono); background: var(--bg-elevated); padding: 1px 6px; border-radius: 3px; font-size: 0.9em; color: var(--accent); }
  .md-content pre { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; margin: 1em 0; }
  .md-content pre code { background: none; padding: 0; color: var(--text-secondary); }
  .md-content blockquote { border-left: 3px solid var(--border); padding-left: 12px; color: var(--text-muted); margin: 0.8em 0; }
  .md-content strong { color: var(--text-primary); }
  .md-content hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
  .md-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 12px; }
  .md-content th { background: var(--bg-elevated); padding: 8px 12px; text-align: left; border: 1px solid var(--border); color: var(--text-primary); }
  .md-content td { padding: 8px 12px; border: 1px solid var(--border); color: var(--text-secondary); }
`;

export function CompleteView({ briefMarkdown, scorecard, metrics, events, goal }: CompleteViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('report');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'report', label: 'Report' },
    { id: 'events', label: 'Events' },
    { id: 'rules', label: 'Rules' },
    { id: 'cost', label: 'Cost' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{markdownStyles}</style>

      {/* Tab bar */}
      <div style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        padding: '0 20px',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              padding: '12px 16px',
              fontSize: 13,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: activeTab === 'events' ? 0 : '0 24px', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'report' && (
          <div style={{ maxWidth: 860, paddingTop: 24, paddingBottom: 40 }}>
            <ScorecardGrid scorecard={scorecard} />
            <div className="md-content" style={{ fontSize: 14, lineHeight: 1.7 }}>
              <ReactMarkdown>{briefMarkdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <EventStream
              events={events}
              onNewEvent={() => {}}
              onBudgetPaused={() => {}}
              onRunComplete={() => {}}
              onRunError={() => {}}
              readonly
            />
          </div>
        )}

        {activeTab === 'rules' && (
          <RulesTab goal={goal} />
        )}

        {activeTab === 'cost' && (
          <CostTab metrics={metrics} />
        )}
      </div>
    </div>
  );
}
