'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics, CategoryScore } from '@/lib/agentSession';
import type { Finding } from '@/lib/runTransform';
import { scoreColor, scoreBg, scoreToGrade, scoreToVerdict } from '@/lib/utils';
import { FindingCard } from './FindingCard';

const SEV_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };

function sevDotColor(sev: string): string {
  switch (sev) {
    case 'critical': case 'high': return 'var(--color-danger)';
    case 'medium': return 'var(--color-warning)';
    case 'low': return 'var(--color-success)';
    default: return 'var(--color-tertiary-label)';
  }
}

interface SingleOverviewContentProps {
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  findings: Finding[];
  findingsLoading: boolean;
}

export function SingleOverviewContent({ scorecard, metrics, briefMarkdown, findings, findingsLoading }: SingleOverviewContentProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) {
      const cat = f.category || 'uncategorized';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(f);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
    }
    return map;
  }, [findings]);

  const categories = useMemo(() => {
    const result: Array<{ name: string; score?: CategoryScore; findings: Finding[] }> = [];
    const used = new Set<string>();
    for (const cat of scorecard.categories) {
      result.push({ name: cat.category, score: cat, findings: grouped.get(cat.category) || [] });
      used.add(cat.category);
    }
    for (const [cat, items] of grouped) {
      if (!used.has(cat)) result.push({ name: cat, findings: items });
    }
    return result;
  }, [scorecard.categories, grouped]);

  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => {
    const worstCat = scorecard.categories.reduce<CategoryScore | null>((w, c) => {
      if (!w) return c;
      return (SCORE_ORDER[c.score] ?? 0) > (SCORE_ORDER[w.score] ?? 0) ? c : w;
    }, null);
    return worstCat ? new Set([worstCat.category]) : new Set();
  });

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const durationS = (metrics.durationMs / 1000).toFixed(0);

  return (
    <div data-component="SingleOverviewContent" className="max-w-[860px] pt-5 pb-8">

      {/* ─── Level 1: The Verdict ──────────────────────── */}
      <div className="flex items-start gap-5 mb-8">
        <div
          className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: scoreBg(scorecard.overallScore) }}
        >
          <span
            className="text-[36px] font-bold font-brand leading-none"
            style={{ color: scoreColor(scorecard.overallScore) }}
          >
            {scoreToGrade(scorecard.overallScore)}
          </span>
        </div>
        <div className="pt-1 min-w-0">
          <div className="text-[17px] font-semibold text-label">
            {scorecard.repoName}
          </div>
          <div className="text-[13px] text-secondary-label mt-0.5">
            {scoreToVerdict(scorecard.overallScore)}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[11px] text-tertiary-label">
            <span>{scorecard.goalType}</span>
            <span className="text-quaternary-label">·</span>
            <span className="font-mono">${metrics.totalEstimatedCostUsd.toFixed(2)}</span>
            <span className="text-quaternary-label">·</span>
            <span>{durationS}s</span>
            <span className="text-quaternary-label">·</span>
            <span>{metrics.toolCalls} calls</span>
          </div>
        </div>
      </div>

      {/* ─── Level 2: Top Risks ────────────────────────── */}
      {scorecard.topRisks.length > 0 && (() => {
        const sevTextColor = (s: string) =>
          s === 'critical' || s === 'high' ? 'text-danger' : s === 'medium' ? 'text-warning' : 'text-tertiary-label';
        return (
          <div className="mb-8">
            <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-3">
              Top Risks
            </div>
            <div className="flex flex-col gap-2">
              {scorecard.topRisks.slice(0, 3).map((risk, i) => (
                <div key={risk.findingId ?? `risk-${i}`} className="flex items-start gap-2.5 text-[12px]">
                  <span className="text-tertiary-label shrink-0 w-4 text-right">{i + 1}.</span>
                  <span className={`shrink-0 font-medium uppercase text-[10px] mt-0.5 ${sevTextColor(risk.severity)}`}>
                    {risk.severity}
                  </span>
                  <span className="text-secondary-label">{risk.title}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ─── Level 3: Unified Categories + Findings ────── */}
      <div className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold">
            Categories ({scorecard.categories.length})
            {!findingsLoading && findings.length > 0 && (
              <span className="normal-case ml-1">· {findings.length} findings</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {categories.map(({ name, score, findings: catFindings }) => {
            const isExpanded = expandedCats.has(name);
            const canExpand = !findingsLoading && catFindings.length > 0;
            const counts: Record<string, number> = {};
            for (const f of catFindings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

            return (
              <div key={name} className="rounded-xl overflow-hidden border border-separator">
                <button
                  type="button"
                  onClick={canExpand ? () => toggleCat(name) : undefined}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                    canExpand ? 'hover:bg-elevated/30 cursor-pointer' : 'cursor-default'
                  }`}
                  style={score ? { background: scoreBg(score.score) } : undefined}
                >
                  {score && (
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${scoreColor(score.score)} 15%, transparent)` }}
                    >
                      <span
                        className="text-[13px] font-bold font-brand"
                        style={{ color: scoreColor(score.score) }}
                      >
                        {scoreToGrade(score.score)}
                      </span>
                    </div>
                  )}

                  <span className="text-[12px] font-semibold text-label flex-1 min-w-0 truncate">
                    {name}
                  </span>

                  {canExpand && (
                    <div className="flex items-center gap-1.5 shrink-0">
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
                  )}

                  <span className={`text-[10px] text-tertiary-label shrink-0 ${findingsLoading ? 'animate-pulse' : ''}`}>
                    {findingsLoading ? '–' : catFindings.length}
                  </span>

                  {canExpand && (
                    <svg
                      width="8" height="8" viewBox="0 0 8 8" fill="none"
                      className={`shrink-0 text-tertiary-label transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    >
                      <path d="M3 2l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {isExpanded && canExpand && (
                  <div className="px-3 pb-3 space-y-1.5 border-t border-separator/30 pt-2">
                    {catFindings.map((f, i) => (
                      <FindingCard key={`${f.id}-${i}`} finding={f} index={i} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Level 4: Analysis Brief ──────────────────── */}
      {briefMarkdown && (
        <div className="border-t border-separator pt-6">
          <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-4">
            Analysis Brief
          </div>
          <div className="md-content text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefMarkdown}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
