'use client';

import { useState } from 'react';
import type { Scorecard, RunMetrics, CategoryScore } from '@/lib/agentSession';
import { FindingCard } from './FindingCard';
import type { Finding } from '@/lib/runTransform';
import { scoreColor } from '@/lib/utils';

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

