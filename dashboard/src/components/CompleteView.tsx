'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics, CategoryScore, StepEvent } from '@/lib/agentSession';
import {
  copyToClipboard,
  buildReportMarkdown,
  exportReportMarkdown,
  exportEventsCSV,
  exportCostCSV,
  costToMarkdown,
} from '@/lib/export';
import { EventStream } from './EventStream';
import { scoreColor, scoreToGrade, scoreToVerdict } from '@/lib/utils';

interface CompleteViewProps {
  briefMarkdown: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  events: StepEvent[];
  goal: string;
}

type Tab = 'report' | 'events' | 'rules' | 'cost';

// ─── Exec Summary Banner ───────────────────────────────────────

function ExecSummaryBanner({ scorecard, metrics }: { scorecard: Scorecard; metrics: RunMetrics }) {
  const grade = scoreToGrade(scorecard.overallScore);
  const gradeColor = scoreColor(scorecard.overallScore);
  const verdict = scoreToVerdict(scorecard.overallScore);

  return (
    <div className="px-6 py-4 border-b border-separator bg-surface shrink-0">
      <div className="flex items-start gap-5 max-w-[860px]">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${gradeColor} 10%, transparent)` }}
        >
          <span className="text-[28px] font-bold font-brand" style={{ color: gradeColor }}>
            {grade}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-label mb-1">{verdict}</div>
          <div className="flex items-center gap-4 text-[12px] text-secondary-label mb-2 flex-wrap">
            <span>{scorecard.categories.length} categories scored</span>
            <span>{metrics.toolCalls} tool calls</span>
            <span>${metrics.totalEstimatedCostUsd.toFixed(2)}</span>
            <span>{(metrics.durationMs / 1000).toFixed(0)}s</span>
          </div>
          {scorecard.topRisks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {scorecard.topRisks.slice(0, 3).map(risk => (
                <span
                  key={risk.id}
                  className="text-[11px] px-2 py-0.5 rounded-md"
                  style={{
                    background: risk.severity === 'critical' || risk.severity === 'high'
                      ? 'rgba(255,59,48,0.08)' : 'rgba(255,149,0,0.08)',
                    color: risk.severity === 'critical' || risk.severity === 'high'
                      ? 'var(--color-danger)' : 'var(--color-warning)',
                  }}
                >
                  {risk.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScorecardGrid({ scorecard, metrics }: { scorecard: Scorecard; metrics?: RunMetrics }) {
  return (
    <div className="mb-6">
      {/* Overall score */}
      <div
        className="flex items-center gap-3 mb-4 p-3 bg-surface rounded-lg border border-separator shadow-sm"
      >
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: scoreColor(scorecard.overallScore) }}
          role="img"
          aria-label={`Score: ${scorecard.overallScore}`}
        />
        <div className="flex-1">
          <span className="font-bold text-sm text-label">
            Overall: {scorecard.overallScore.toUpperCase()}
          </span>
          <span className="text-tertiary-label text-xs ml-3">
            {scorecard.repoName} · {scorecard.goalType}
          </span>
        </div>
        {metrics && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-bold font-mono text-tint">
              ${metrics.totalEstimatedCostUsd.toFixed(2)}
            </span>
            <span className="text-[10px] text-tertiary-label">
              {(metrics.durationMs / 1000).toFixed(0)}s · {metrics.toolCalls} calls
            </span>
          </div>
        )}
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
        {scorecard.categories.map((cat: CategoryScore) => (
          <div
            key={cat.category}
            className="bg-surface rounded-lg border border-separator shadow-sm p-3"
          >
            <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-medium">
              {cat.category}
            </div>
            <div className="flex justify-between items-center mt-1.5">
              <span className="text-xs font-semibold" style={{ color: scoreColor(cat.score) }}>
                {cat.score.toUpperCase()}
              </span>
              <span className="text-[11px] text-tertiary-label">
                {cat.findings.length} findings
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Top risks */}
      {scorecard.topRisks.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
            Top Risks
          </div>
          {scorecard.topRisks.slice(0, 3).map(risk => (
            <div
              key={risk.id}
              className="bg-surface rounded-lg border border-separator shadow-sm p-3 mb-2 text-xs"
            >
              <span className="text-danger font-bold mr-2">
                [{risk.severity.toUpperCase()}]
              </span>
              <span className="text-label">{risk.title}</span>
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
    <div className="py-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 mb-6">
        {[
          { label: 'Total Cost', value: `$${metrics.totalEstimatedCostUsd.toFixed(4)}`, accent: true },
          { label: 'Duration', value: `${durationS}s` },
          { label: 'Tool Calls', value: String(metrics.toolCalls) },
          { label: 'Models Used', value: String(modelEntries.length) },
        ].map(item => (
          <div key={item.label} className="bg-surface rounded-lg border border-separator shadow-sm p-3">
            <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-1.5">
              {item.label}
            </div>
            <div className={`text-xl font-bold font-mono ${item.accent ? 'text-tint' : 'text-label'}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs">
        <div className="text-tertiary-label font-semibold mb-3 text-[10px] uppercase tracking-wide">
          Model Breakdown
        </div>
        <div className="bg-surface rounded-lg border border-separator shadow-sm overflow-hidden">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-canvas text-tertiary-label text-[11px]">
                {['Model', 'Calls', 'Input', 'Output', 'Cached', 'Cost'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelEntries.map(([modelId, info]) => (
                <tr key={modelId} className="border-t border-separator">
                  <td className="px-4 py-2.5 text-label max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {modelId.replace('us.anthropic.', '')}
                  </td>
                  <td className="px-4 py-2.5 text-secondary-label">{info.calls}</td>
                  <td className="px-4 py-2.5 text-secondary-label">{info.inputTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-secondary-label">{info.outputTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-secondary-label">{info.cachedTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-success font-medium">${info.estimatedCostUsd.toFixed(4)}</td>
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
    return <div className="p-6 text-tertiary-label text-sm">Loading rules...</div>;
  }

  if (Object.keys(rules).length === 0) {
    return <div className="p-6 text-tertiary-label text-sm">No rules found for goal: {goal}</div>;
  }

  return (
    <div className="py-6">
      {Object.entries(rules).map(([filename, content]) => (
        <div key={filename} className="mb-8">
          <div className="text-[11px] text-tertiary-label font-mono uppercase tracking-wide mb-3 font-medium">
            {filename}
          </div>
          <div className="bg-surface rounded-lg border border-separator shadow-sm p-4 text-xs font-mono text-secondary-label whitespace-pre-wrap leading-relaxed">
            {content}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-elevated text-secondary-label
                 hover:text-label hover:bg-separator transition-colors cursor-pointer
                 border border-separator/60"
    >
      {label}
    </button>
  );
}

function CopiedToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="text-[12px] text-success font-medium animate-slide-up ml-2">
      Copied
    </span>
  );
}

export function CompleteView({ briefMarkdown, scorecard, metrics, events, goal }: CompleteViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('report');
  const [copied, setCopied] = useState(false);

  const flash = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'report', label: 'Report' },
    { id: 'events', label: 'Events' },
    { id: 'rules', label: 'Rules' },
    { id: 'cost', label: 'Cost' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Exec summary banner */}
      <ExecSummaryBanner scorecard={scorecard} metrics={metrics} />

      {/* Segmented control tab bar */}
      <div className="bg-surface shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-6 py-2.5 flex items-center">
        <div className="bg-elevated rounded-lg p-0.5 flex gap-0.5" role="tablist" aria-label="Report sections">
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-1.5 min-w-[72px] min-h-touch rounded-md text-[13px] font-medium transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-surface text-label shadow-sm'
                  : 'text-secondary-label hover:text-label'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Export actions — right side of tab bar */}
        <div className="ml-auto flex items-center gap-2">
          <CopiedToast visible={copied} />

          {activeTab === 'report' && (
            <>
              <ExportButton
                label="Copy Markdown"
                onClick={async () => {
                  const ok = await copyToClipboard(buildReportMarkdown(briefMarkdown, scorecard));
                  if (ok) flash();
                }}
              />
              <ExportButton
                label="Export .md"
                onClick={() => exportReportMarkdown(briefMarkdown, scorecard)}
              />
            </>
          )}

          {activeTab === 'events' && (
            <ExportButton
              label="Export CSV"
              onClick={() => exportEventsCSV(events, scorecard.repoName)}
            />
          )}

          {activeTab === 'cost' && (
            <>
              <ExportButton
                label="Copy Markdown"
                onClick={async () => {
                  const ok = await copyToClipboard(costToMarkdown(metrics));
                  if (ok) flash();
                }}
              />
              <ExportButton
                label="Export CSV"
                onClick={() => exportCostCSV(metrics, scorecard.repoName)}
              />
            </>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className={`flex-1 overflow-auto flex flex-col ${activeTab === 'events' ? '' : 'px-6'}`}>
        <div key={activeTab} role="tabpanel" aria-label={activeTab} className="animate-slide-up flex-1 flex flex-col">
          {activeTab === 'report' && (
            <div className="max-w-[860px] pt-5 pb-8">
              <ScorecardGrid scorecard={scorecard} metrics={metrics} />
              <div className="md-content text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefMarkdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {activeTab === 'events' && (
            <div className="flex-1 flex flex-col">
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

          {activeTab === 'rules' && <RulesTab goal={goal} />}
          {activeTab === 'cost' && <CostTab metrics={metrics} />}
        </div>
      </div>
    </div>
  );
}
