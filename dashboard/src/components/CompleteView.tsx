'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics, CategoryScore, StepEvent } from '@/lib/agentSession';
import {
  copyToClipboard,
  buildReportMarkdown,
  exportReportMarkdown,
  exportReportPDF,
  exportEventsCSV,
  exportCostCSV,
  costToMarkdown,
} from '@/lib/export';
import { AnalysisView } from './AnalysisView';
import { FindingCard } from './FindingCard';
import { FindingsLoadingSkeleton, EventsLoadingSkeleton } from './Skeleton';
import { normalizeFindings, transformRunData, type Finding, type TransformedRunData } from '@/lib/runTransform';
import { CreateIssuesModal } from './CreateIssuesModal';
import { scoreColor, scoreToGrade, scoreToVerdict } from '@/lib/utils';
import type { Tab } from '@/lib/useUrlState';

interface CompleteViewProps {
  briefMarkdown: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  events: StepEvent[];
  goal: string;
  findings?: unknown[];
  runId?: string;
  /** GitHub URL for the analyzed repo (used by Create Issues). */
  repoUrl?: string;
  /** Controlled active tab (from URL state). */
  activeTab?: Tab;
  /** Callback when tab changes (syncs to URL). */
  onTabChange?: (tab: Tab) => void;
  /** Pre-transformed run data for investigation replay (optional — lazy-loads events if not provided). */
  investigationRunData?: import('@/lib/runTransform').TransformedRunData;
}

// ─── Exec Summary Banner ───────────────────────────────────────

function ExecSummaryBanner({ scorecard, metrics }: { scorecard: Scorecard; metrics: RunMetrics }) {
  const grade = scoreToGrade(scorecard.overallScore);
  const gradeColor = scoreColor(scorecard.overallScore);
  const verdict = scoreToVerdict(scorecard.overallScore);

  return (
    <div data-component="ExecSummaryBanner" className="px-6 py-4 border-b border-separator bg-surface shrink-0">
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
              {scorecard.topRisks.slice(0, 3).map((risk, i) => (
                <span
                  key={risk.findingId ?? `risk-${i}`}
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

export function scrollToFinding(findingId: string) {
  const el = document.getElementById(`finding-${findingId}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function scrollToCategory(category: string) {
  // Find first finding element with data-category matching
  const el = document.querySelector(`[data-finding-category="${category}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function ScorecardGrid({ scorecard, metrics }: { scorecard: Scorecard; metrics?: RunMetrics }) {
  return (
    <div data-component="ScorecardGrid" className="mb-6">
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
        {scorecard.categories.map((cat: CategoryScore, i: number) => (
          <button
            key={`${cat.category}-${i}`}
            type="button"
            onClick={() => scrollToCategory(cat.category)}
            className="bg-surface rounded-lg border border-separator shadow-sm p-3 text-left cursor-pointer hover:border-tint/30 transition-colors"
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
          </button>
        ))}
      </div>

      {/* Top risks */}
      {scorecard.topRisks.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
            Top Risks
          </div>
          {scorecard.topRisks.slice(0, 3).map((risk, i) => (
            <button
              key={risk.findingId ?? `risk-${i}`}
              type="button"
              onClick={() => scrollToFinding(risk.findingId)}
              className="w-full text-left bg-surface rounded-lg border border-separator shadow-sm p-3 mb-2 text-xs cursor-pointer hover:border-danger/30 transition-colors"
            >
              <span className="text-danger font-bold mr-2">
                [{risk.severity.toUpperCase()}]
              </span>
              <span className="text-label">{risk.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Findings Section (grouped by category) ──────────────────

const SEV_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function FindingsSection({ findings, scorecard }: { findings: Finding[]; scorecard: Scorecard }) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  if (findings.length === 0) return null;

  // Group by category, ordered by scorecard category order
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const cat = f.category || 'uncategorized';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(f);
  }

  // Sort findings within each group by severity
  for (const arr of grouped.values()) {
    arr.sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
  }

  // Order categories by scorecard order, then remaining
  const scorecardOrder: string[] = scorecard.categories.map(c => c.category);
  const orderedCats = [
    ...scorecardOrder.filter(c => grouped.has(c)),
    ...[...grouped.keys()].filter(c => !scorecardOrder.includes(c)),
  ];

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const sevCounts = (items: Finding[]) => {
    const counts: Record<string, number> = {};
    for (const f of items) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    return counts;
  };

  const sevDotColor = (sev: string) => {
    switch (sev) {
      case 'critical': case 'high': return 'var(--color-danger)';
      case 'medium': return 'var(--color-warning)';
      case 'low': return 'var(--color-success)';
      default: return 'var(--color-tertiary-label)';
    }
  };

  return (
    <div data-component="FindingsSection" className="mb-6">
      <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-3">
        Findings ({findings.length})
      </div>
      <div className="flex flex-col gap-2">
        {orderedCats.map(cat => {
          const items = grouped.get(cat)!;
          const isExpanded = expandedCats.has(cat);
          const counts = sevCounts(items);
          // Find scorecard score for this category
          const catScore = scorecard.categories.find(c => c.category === cat);

          return (
            <div key={cat} className="rounded-lg border border-separator overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCat(cat)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-elevated/50 transition-colors cursor-pointer"
              >
                <svg
                  width="8" height="8" viewBox="0 0 8 8" fill="none"
                  className={`shrink-0 text-tertiary-label transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M3 2l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[12px] font-semibold text-label flex-1">
                  {cat}
                </span>
                {catScore && (
                  <span
                    className="text-[10px] font-bold uppercase"
                    style={{ color: scoreColor(catScore.score) }}
                  >
                    {catScore.score}
                  </span>
                )}
                <div className="flex items-center gap-1.5 ml-2">
                  {(['critical', 'high', 'medium', 'low', 'info'] as const)
                    .filter(s => counts[s])
                    .map(s => (
                      <span key={s} className="flex items-center gap-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: sevDotColor(s) }}
                        />
                        <span className="text-[10px] text-tertiary-label">{counts[s]}</span>
                      </span>
                    ))}
                </div>
                <span className="text-[10px] text-tertiary-label ml-1">
                  {items.length}
                </span>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 space-y-1.5 border-t border-separator/50 pt-2">
                  {items.map((f, i) => (
                    <FindingCard key={`${f.id}-${i}`} finding={f} index={i} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CostTab({ metrics }: { metrics: RunMetrics }) {
  const durationS = (metrics.durationMs / 1000).toFixed(1);
  const modelEntries = Object.entries(metrics.models);

  return (
    <div data-component="CostTab" className="py-5">
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

export function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
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

export function CopiedToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="text-[12px] text-success font-medium animate-slide-up ml-2">
      Copied
    </span>
  );
}

export function CompleteView({ briefMarkdown, scorecard, metrics, events, goal, findings, runId, repoUrl, activeTab: controlledTab, onTabChange, investigationRunData }: CompleteViewProps) {
  const [internalTab, setInternalTab] = useState<Tab>('overview');
  const activeTab = controlledTab ?? internalTab;
  const [copied, setCopied] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [lazyRunData, setLazyRunData] = useState<TransformedRunData | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const eventsFailed = useRef(false);
  const [lazyFindings, setLazyFindings] = useState<Finding[] | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [replayAnimated, setReplayAnimated] = useState(false);

  // Normalize findings from props, or use lazy-loaded findings
  const typedFindings: Finding[] = lazyFindings
    ?? (findings && findings.length > 0 ? normalizeFindings(findings) : []);

  // Lazy-load findings when slim mode returned empty array
  useEffect(() => {
    if (typedFindings.length === 0 && !findingsLoading && !lazyFindings && runId) {
      setFindingsLoading(true);
      fetch(`/api/history/${encodeURIComponent(runId)}`)
        .then(r => r.json())
        .then(data => {
          const raw = data.result?.state?.findings;
          setLazyFindings(raw && raw.length > 0 ? normalizeFindings(raw) : []);
        })
        .catch(err => {
          console.warn('[findings] Failed to load:', err);
          setLazyFindings([]);
        })
        .finally(() => setFindingsLoading(false));
    }
  }, [runId, typedFindings.length, findingsLoading, lazyFindings]);

  // Resolve investigation run data: prop > lazy-loaded > null
  const resolvedRunData = investigationRunData ?? lazyRunData;

  // Lazy-load events when investigation tab is active on mount (direct URL navigation)
  useEffect(() => {
    if (activeTab === 'investigation' && !resolvedRunData && !eventsLoading && !eventsFailed.current && runId && !runId.startsWith('__')) {
      setEventsLoading(true);
      fetch(`/api/history/${encodeURIComponent(runId)}/events`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (data.events) {
            const rd = transformRunData(data.events, {
              scorecard,
              metrics,
              terminationReason: 'completed',
              briefMarkdown: '',
              outputPaths: [],
              state: { findings: findings ?? [] },
            });
            setLazyRunData(rd);
          } else {
            eventsFailed.current = true;
          }
        })
        .catch(err => {
          console.warn('[events] Failed to load:', err);
          eventsFailed.current = true;
        })
        .finally(() => setEventsLoading(false));
    }
  }, [activeTab, resolvedRunData, eventsLoading, runId, scorecard, metrics, findings]);

  const handleTabChange = useCallback((tab: Tab) => {
    if (onTabChange) onTabChange(tab);
    else setInternalTab(tab);
    // Lazy-load events when switching to investigation tab
    if (tab === 'investigation' && !resolvedRunData && !eventsLoading && !eventsFailed.current && runId && !runId.startsWith('__')) {
      setEventsLoading(true);
      fetch(`/api/history/${encodeURIComponent(runId)}/events`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (data.events) {
            const rd = transformRunData(data.events, {
              scorecard,
              metrics,
              terminationReason: 'completed',
              briefMarkdown: '',
              outputPaths: [],
              state: { findings: findings ?? [] },
            });
            setLazyRunData(rd);
          } else {
            eventsFailed.current = true;
          }
        })
        .catch(err => {
          console.warn('[events] Failed to load:', err);
          eventsFailed.current = true;
        })
        .finally(() => setEventsLoading(false));
    }
  }, [resolvedRunData, eventsLoading, runId, onTabChange, scorecard, metrics, findings]);

  const flash = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'investigation', label: 'Investigation' },
    { id: 'cost', label: 'Cost' },
  ];

  return (
    <div data-component="CompleteView" className="flex-1 flex flex-col overflow-hidden">
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
              onClick={() => handleTabChange(tab.id)}
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

          {activeTab === 'overview' && (
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
              <ExportButton
                label={pdfExporting ? 'Exporting...' : 'Export PDF'}
                onClick={async () => {
                  setPdfExporting(true);
                  try {
                    let resolvedFindings = findings ?? [];
                    if (resolvedFindings.length === 0 && runId) {
                      try {
                        const r = await fetch(`/api/history/${encodeURIComponent(runId)}`);
                        const data = await r.json();
                        if (data.result?.state?.findings) {
                          resolvedFindings = data.result.state.findings;
                        }
                      } catch { /* proceed with empty findings */ }
                    }
                    await exportReportPDF(scorecard, resolvedFindings, metrics);
                  } catch (err) {
                    console.error('PDF export failed:', err);
                  } finally {
                    setPdfExporting(false);
                  }
                }}
              />
              <ExportButton
                label="Create Issues"
                onClick={() => setIssueModalOpen(true)}
              />
            </>
          )}

          {activeTab === 'investigation' && resolvedRunData && (
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
      <div className={`flex-1 overflow-auto flex flex-col ${activeTab === 'investigation' ? '' : 'px-6'}`}>
        <div key={activeTab} role="tabpanel" aria-label={activeTab} className="animate-slide-up flex-1 flex flex-col">
          {activeTab === 'overview' && (
            <div className="max-w-[860px] pt-5 pb-8">
              <ScorecardGrid scorecard={scorecard} metrics={metrics} />
              {findingsLoading && <FindingsLoadingSkeleton />}
              {typedFindings.length > 0 && (
                <FindingsSection findings={typedFindings} scorecard={scorecard} />
              )}
              <div className="md-content text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefMarkdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {activeTab === 'investigation' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {eventsLoading ? (
                <div className="p-6"><EventsLoadingSkeleton /></div>
              ) : resolvedRunData ? (
                <AnalysisView
                  runData={resolvedRunData}
                  viewMode={replayAnimated ? 'replay' : 'instant'}
                  onStartReplay={() => setReplayAnimated(true)}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <p className="text-sm text-tertiary-label">No investigation events available.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'cost' && <CostTab metrics={metrics} />}
        </div>
      </div>

      <CreateIssuesModal
        isOpen={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        findings={typedFindings}
        repoUrl={repoUrl}
      />
    </div>
  );
}
