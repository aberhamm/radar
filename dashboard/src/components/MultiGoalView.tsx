'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics, StepEvent, CategoryScore, ScoreLevel } from '@/lib/agentSession';
import { transformRunData, type TransformedRunData, normalizeFindings, type Finding } from '@/lib/runTransform';
import {
  copyToClipboard,
  buildMultiGoalMarkdown,
  exportMultiGoalMarkdown,
  exportReportPDF,
  exportEventsCSV,
  exportCostCSV,
  costToMarkdown,
} from '@/lib/export';
import { AnalysisView } from './AnalysisView';
import { FindingsSection, ExportButton, CopiedToast, CostTab } from './CompleteView';
import { FindingsLoadingSkeleton } from './Skeleton';
import { CreateIssuesModal } from './CreateIssuesModal';
import { scoreColor, scoreBg, scoreToGrade, scoreToVerdict } from '@/lib/utils';
import type { MultiTab } from '@/lib/useUrlState';

// ─── Types ──────────────────────────────────────────────────────

export interface MultiGoalGoal {
  id: string;
  goal: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  findingsCount: number;
}

export interface MultiGoalData {
  parentId: string;
  repoName: string;
  repoUrl?: string;
  startedAt: string;
  completedAt?: string;
  goals: MultiGoalGoal[];
  events: StepEvent[];
  findings: unknown[];
  totalFindings: number;
}

interface MultiGoalViewProps {
  data: MultiGoalData;
  activeTab?: MultiTab;
  onTabChange?: (tab: MultiTab) => void;
}

// ─── Helpers ────────────────────────────────────────────────────

const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };
const SEV_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

// Backend RankedRisk uses `findingId`; dashboard Scorecard expects `id`. Normalize at boundary.
function normalizeRiskId(risk: { id?: string; findingId?: string; severity: string; title: string }): { id: string; severity: string; title: string } {
  return { id: risk.id ?? risk.findingId ?? '', severity: risk.severity, title: risk.title };
}

function goalDisplayName(goal: string): string {
  const names: Record<string, string> = {
    onboarding: 'Onboarding',
    audit: 'Audit',
    migration: 'Migration',
    'component-map': 'Components',
    'ci-check': 'CI Check',
    'security-review': 'Security',
    nextjs: 'Next.js',
    accessibility: 'Accessibility',
  };
  return names[goal] ?? goal;
}

function goalDescription(goal: string): string {
  const descs: Record<string, string> = {
    onboarding: 'Developer onboarding brief',
    audit: 'Architecture quality assessment',
    migration: 'Upgrade path readiness',
    'component-map': 'Component inventory',
    'ci-check': 'CI pipeline health',
    'security-review': 'Security vulnerabilities',
    nextjs: 'Framework patterns',
    accessibility: 'WCAG 2.1 AA compliance',
  };
  return descs[goal] ?? '';
}

/**
 * Aggregate metrics from all goals into a single RunMetrics.
 *
 * NOTE: In multi-goal runs, all 8 child goals receive the SAME metrics object
 * (from the last pass result). We deduplicate by checking object identity —
 * if all goals share the same metrics, we use it directly instead of summing 8x.
 */
function aggregateMetrics(goals: MultiGoalGoal[], events: StepEvent[], startedAt: string, completedAt?: string): RunMetrics {
  const allMetrics = goals.map(g => g.metrics).filter(Boolean);
  if (allMetrics.length === 0) {
    return { startedAt: '', completedAt: '', durationMs: 0, toolCalls: 0, models: {}, totalEstimatedCostUsd: 0 };
  }

  // Deduplicate: if all goals share identical metrics (same cost, same duration),
  // they came from the same run result — use as-is instead of summing.
  const first = allMetrics[0];
  const allIdentical = allMetrics.every(m =>
    m.totalEstimatedCostUsd === first.totalEstimatedCostUsd &&
    m.durationMs === first.durationMs,
  );

  if (allIdentical) {
    return {
      ...first,
      startedAt,
      completedAt: completedAt ?? '',
      toolCalls: events.filter(e => e.type === 'tool_call').length,
    };
  }

  // Truly distinct metrics — sum them
  const mergedModels: RunMetrics['models'] = {};
  for (const m of allMetrics) {
    for (const [modelId, info] of Object.entries(m.models)) {
      if (!mergedModels[modelId]) {
        mergedModels[modelId] = { ...info };
      } else {
        mergedModels[modelId].calls += info.calls;
        mergedModels[modelId].inputTokens += info.inputTokens;
        mergedModels[modelId].outputTokens += info.outputTokens;
        mergedModels[modelId].cachedTokens += info.cachedTokens;
        mergedModels[modelId].estimatedCostUsd += info.estimatedCostUsd;
      }
    }
  }

  return {
    startedAt,
    completedAt: completedAt ?? '',
    durationMs: allMetrics.reduce((sum, m) => sum + m.durationMs, 0),
    toolCalls: events.filter(e => e.type === 'tool_call').length,
    models: mergedModels,
    totalEstimatedCostUsd: allMetrics.reduce((sum, m) => sum + m.totalEstimatedCostUsd, 0),
  };
}

/** Build a merged scorecard across all goals for cross-goal findings display. */
function buildMergedScorecard(goals: MultiGoalGoal[], repoName: string, startedAt: string, worstScore: ScoreLevel): Scorecard {
  const catMap = new Map<string, CategoryScore>();
  for (const g of goals) {
    for (const cat of g.scorecard.categories) {
      const existing = catMap.get(cat.category);
      if (!existing || (SCORE_ORDER[cat.score] ?? 0) > (SCORE_ORDER[existing.score] ?? 0)) {
        catMap.set(cat.category, cat);
      }
    }
  }

  const seen = new Set<string>();
  const allRisks = goals.flatMap(g => (g.scorecard.topRisks ?? []).map(normalizeRiskId)).filter(r => {
    if (!r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));

  return {
    repoName,
    goalType: 'all',
    generatedAt: startedAt,
    overallScore: worstScore,
    categories: [...catMap.values()],
    topRisks: allRisks,
  };
}

// ─── Scoreboard ─────────────────────────────────────────────────

function Scoreboard({ goals, onScrollTo }: { goals: MultiGoalGoal[]; onScrollTo: (goalId: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2">
      {goals.map(g => (
        <button
          key={g.id}
          onClick={() => onScrollTo(g.id)}
          className="flex-1 min-w-[120px] text-center p-4 rounded-xl border border-separator hover:border-tint hover:shadow-md transition-all cursor-pointer group"
          style={{ background: scoreBg(g.scorecard.overallScore) }}
        >
          <div
            className="text-[24px] font-bold font-brand mb-1"
            style={{ color: scoreColor(g.scorecard.overallScore) }}
          >
            {scoreToGrade(g.scorecard.overallScore)}
          </div>
          <div className="text-[13px] font-semibold text-label group-hover:text-tint transition-colors mb-0.5">
            {goalDisplayName(g.goal)}
          </div>
          <div className="text-[11px] text-tertiary-label">
            {g.findingsCount} findings
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Top Risks ──────────────────────────────────────────────────

function TopRisks({ goals }: { goals: MultiGoalGoal[] }) {
  const seen = new Set<string>();
  const allRisks: Array<{ id: string; severity: string; title: string }> = [];
  for (const g of goals) {
    for (const raw of g.scorecard.topRisks ?? []) {
      const risk = normalizeRiskId(raw);
      if (risk.id && !seen.has(risk.id)) {
        seen.add(risk.id);
        allRisks.push(risk);
      }
    }
  }

  const sorted = allRisks
    .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0))
    .slice(0, 8);

  if (sorted.length === 0) return null;

  const sevColor = (s: string) =>
    s === 'critical' || s === 'high' ? 'text-danger' : s === 'medium' ? 'text-warning' : 'text-tertiary-label';

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-label mb-3">Top Risks</h3>
      <div className="flex flex-col gap-2">
        {sorted.map((risk, i) => (
          <div key={risk.id} className="flex items-start gap-2.5 text-[12px]">
            <span className="text-tertiary-label shrink-0 w-4 text-right">{i + 1}.</span>
            <span className={`shrink-0 font-medium uppercase text-[10px] mt-0.5 ${sevColor(risk.severity)}`}>
              {risk.severity}
            </span>
            <span className="text-secondary-label">{risk.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pass Breakdown ─────────────────────────────────────────────

interface PassInfo {
  name: string;
  eventCount: number;
  budget?: number;
  terminationReason?: string;
}

function PassBreakdown({ events }: { events: StepEvent[] }) {
  const passes: PassInfo[] = [];
  let currentPass = 'Core';
  let currentCount = 0;

  const completions = new Map<string, { toolCalls: number; budget: number; terminationReason: string }>();
  for (const ev of events) {
    if (ev.action === 'pass_complete' && ev.result) {
      try {
        const data = JSON.parse(ev.result as string);
        completions.set(data.pass, data);
      } catch { /* ignore parse errors */ }
    }
  }

  for (const ev of events) {
    if (ev.action === 'pass_boundary') {
      const completion = completions.get(currentPass);
      passes.push({
        name: currentPass,
        eventCount: completion?.toolCalls ?? currentCount,
        budget: completion?.budget,
        terminationReason: completion?.terminationReason,
      });
      currentPass = (ev.result as string) ?? 'Next pass';
      currentCount = 0;
    } else if (ev.type === 'tool_call') {
      currentCount++;
    }
  }
  const lastCompletion = completions.get(currentPass);
  passes.push({
    name: currentPass,
    eventCount: lastCompletion?.toolCalls ?? currentCount,
    budget: lastCompletion?.budget,
    terminationReason: lastCompletion?.terminationReason,
  });

  const totalCalls = passes.reduce((sum, p) => sum + p.eventCount, 0);
  if (totalCalls === 0) return null;

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-label mb-3">Investigation Passes</h3>
      <div className="flex flex-col gap-2">
        {passes.map(pass => {
          const pct = pass.budget
            ? Math.min((pass.eventCount / pass.budget) * 100, 100)
            : totalCalls > 0 ? (pass.eventCount / totalCalls) * 100 : 0;
          const exceeded = pass.budget ? pass.eventCount >= pass.budget : false;
          const barColor = exceeded ? 'var(--color-warning, #ff9500)' : 'var(--color-tint)';
          return (
            <div key={pass.name} className="flex items-center gap-3">
              <span className="text-[12px] text-secondary-label w-[140px] shrink-0 truncate">
                {pass.name}
              </span>
              <div className="flex-1 h-2 bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
              <span className={`text-[11px] w-[100px] text-right shrink-0 ${exceeded ? 'text-warning font-medium' : 'text-tertiary-label'}`}>
                {pass.eventCount}{pass.budget ? `/${pass.budget}` : ''} calls
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Per-Goal Score Summary ─────────────────────────────────────

function PerGoalSummaryTable({ goals }: { goals: MultiGoalGoal[] }) {
  return (
    <div className="mt-6">
      <div className="text-tertiary-label font-semibold mb-3 text-[10px] uppercase tracking-wide">
        Per-Goal Summary
      </div>
      <div className="bg-surface rounded-lg border border-separator shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-canvas text-tertiary-label text-[11px]">
              {['Goal', 'Score', 'Categories', 'Findings'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {goals.map(g => (
              <tr key={g.id} className="border-t border-separator">
                <td className="px-4 py-2.5 text-label font-medium">{goalDisplayName(g.goal)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-bold uppercase" style={{ color: scoreColor(g.scorecard.overallScore) }}>
                    {g.scorecard.overallScore}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-secondary-label">{g.scorecard.categories.length}</td>
                <td className="px-4 py-2.5 text-secondary-label">{g.findingsCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Goal Section (collapsible per-goal report) ─────────────────

function GoalSection({
  goal,
  isExpanded,
  onToggle,
  sectionRef,
}: {
  goal: MultiGoalGoal;
  isExpanded: boolean;
  onToggle: () => void;
  sectionRef: (el: HTMLDivElement | null) => void;
}) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  // Lazy-load findings on first expand
  const handleToggle = useCallback(() => {
    if (!isExpanded && !fetchedRef.current && goal.findingsCount > 0) {
      fetchedRef.current = true;
      setLoading(true);
      fetch(`/api/history/${encodeURIComponent(goal.id)}/findings`)
        .then(r => r.json())
        .then(data => {
          if (data.findings?.length > 0) setFindings(normalizeFindings(data.findings));
          else setFindings([]);
        })
        .catch(() => setFindings([]))
        .finally(() => setLoading(false));
    }
    onToggle();
  }, [isExpanded, goal.id, goal.findingsCount, onToggle]);

  const gradeColor = scoreColor(goal.scorecard.overallScore);

  return (
    <div ref={sectionRef} className="rounded-xl border border-separator overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-elevated/50 transition-colors cursor-pointer"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${gradeColor} 10%, transparent)` }}
        >
          <span className="text-[14px] font-bold font-brand" style={{ color: gradeColor }}>
            {scoreToGrade(goal.scorecard.overallScore)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-label">
            {goalDisplayName(goal.goal)}
          </div>
          <div className="text-[11px] text-tertiary-label">
            {goalDescription(goal.goal)}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-tertiary-label">
            {goal.findingsCount} findings
          </span>
          <span className="text-[11px] text-tertiary-label">
            {goal.scorecard.categories.length} categories
          </span>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            className={`text-tertiary-label transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M2.5 4L5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-5 border-t border-separator/50 pt-4">
          <FindingsSection findings={findings ?? []} scorecard={goal.scorecard} />

          {loading && <FindingsLoadingSkeleton />}
          {findings && findings.length === 0 && !loading && goal.findingsCount > 0 && (
            <div className="text-[12px] text-tertiary-label mb-4">No detailed findings available.</div>
          )}

          {goal.briefMarkdown && (
            <div className="md-content text-sm leading-relaxed mt-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{goal.briefMarkdown}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

const TABS: { id: MultiTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'cost', label: 'Cost' },
];

export function MultiGoalView({ data, activeTab: controlledTab, onTabChange }: MultiGoalViewProps) {
  const [internalTab, setInternalTab] = useState<MultiTab>('overview');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;

  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  const flash = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // Transform events for AnalysisView replay
  const runData: TransformedRunData | undefined = data.events.length > 0
    ? transformRunData(data.events, {
        scorecard: data.goals[0]?.scorecard,
        metrics: data.goals[0]?.metrics,
        terminationReason: 'completed',
        briefMarkdown: '',
        outputPaths: [],
        state: { findings: data.findings },
      })
    : undefined;

  // Aggregate metrics across ALL goals (not just goals[0])
  const metrics = useMemo(
    () => aggregateMetrics(data.goals, data.events, data.startedAt, data.completedAt),
    [data.goals, data.events, data.startedAt, data.completedAt],
  );

  // Worst score across all goals
  const worstScore = useMemo(() =>
    data.goals.reduce<ScoreLevel>((worst, g) => {
      const s = g.scorecard.overallScore;
      return (SCORE_ORDER[s] ?? 0) > (SCORE_ORDER[worst] ?? 0) ? s : worst;
    }, 'green'),
    [data.goals],
  );

  // Merged scorecard for cross-goal findings display + PDF export
  const mergedScorecard = useMemo(
    () => buildMergedScorecard(data.goals, data.repoName, data.startedAt, worstScore),
    [data.goals, data.repoName, data.startedAt, worstScore],
  );

  // Normalize all findings for cross-goal display + issue creation
  const allFindings: Finding[] = useMemo(
    () => data.findings?.length > 0 ? normalizeFindings(data.findings) : [],
    [data.findings],
  );

  const toggleGoal = useCallback((goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }, []);

  const scrollToGoal = useCallback((goalId: string) => {
    setExpandedGoals(prev => new Set(prev).add(goalId));
    requestAnimationFrame(() => {
      sectionRefs.current.get(goalId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const gradeColor = scoreColor(worstScore);
  const verdict = scoreToVerdict(worstScore);

  return (
    <div data-component="MultiGoalView" className="flex-1 flex flex-col overflow-hidden">
      {/* Exec summary banner */}
      <div className="px-6 py-4 border-b border-separator bg-surface shrink-0">
        <div className="flex items-start gap-5 max-w-[860px]">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${gradeColor} 10%, transparent)` }}
          >
            <span className="text-[28px] font-bold font-brand" style={{ color: gradeColor }}>
              {scoreToGrade(worstScore)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[15px] font-semibold text-label">{verdict}</h1>
              <span className="text-[12px] font-medium text-tint bg-[rgb(0_113_227/0.08)] rounded px-2 py-0.5">
                {data.goals.length} goals
              </span>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-secondary-label mb-2 flex-wrap">
              <span>{data.repoName}</span>
              <span>{data.totalFindings} findings</span>
              <span>{metrics.toolCalls} tool calls</span>
              <span>${metrics.totalEstimatedCostUsd.toFixed(2)}</span>
              <span>{(metrics.durationMs / 1000).toFixed(0)}s</span>
            </div>
            {mergedScorecard.topRisks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mergedScorecard.topRisks.slice(0, 3).map((risk, i) => (
                  <span
                    key={risk.id || `risk-${i}`}
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

      {/* Tab bar */}
      <div className="bg-surface shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-6 py-2.5 flex items-center">
        <div className="bg-elevated rounded-lg p-0.5 flex gap-0.5" role="tablist" aria-label="Report sections">
          {TABS.map(tab => (
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

          {activeTab === 'overview' && (
            <>
              <ExportButton
                label="Copy Markdown"
                onClick={async () => {
                  const md = buildMultiGoalMarkdown(
                    data.goals.map(g => ({ goal: g.goal, scorecard: g.scorecard, briefMarkdown: g.briefMarkdown })),
                    data.repoName,
                  );
                  const ok = await copyToClipboard(md);
                  if (ok) flash();
                }}
              />
              <ExportButton
                label="Export .md"
                onClick={() => exportMultiGoalMarkdown(
                  data.goals.map(g => ({ goal: g.goal, scorecard: g.scorecard, briefMarkdown: g.briefMarkdown })),
                  data.repoName,
                )}
              />
              <ExportButton
                label={pdfExporting ? 'Exporting...' : 'Export PDF'}
                onClick={async () => {
                  setPdfExporting(true);
                  try {
                    await exportReportPDF(mergedScorecard, data.findings ?? [], metrics);
                  } catch (err) {
                    console.error('PDF export failed:', err);
                  } finally {
                    setPdfExporting(false);
                  }
                }}
              />
              {allFindings.length > 0 && (
                <ExportButton
                  label="Create Issues"
                  onClick={() => setIssueModalOpen(true)}
                />
              )}
            </>
          )}

          {activeTab === 'investigation' && (
            <ExportButton
              label="Export CSV"
              onClick={() => exportEventsCSV(data.events, data.repoName)}
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
                onClick={() => exportCostCSV(metrics, data.repoName)}
              />
            </>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className={`flex-1 overflow-auto flex flex-col ${activeTab === 'investigation' ? '' : 'px-6'}`}>
        <div key={activeTab} role="tabpanel" aria-label={activeTab} className="animate-slide-up flex-1 flex flex-col">
          {activeTab === 'overview' && (
            <div className="max-w-4xl pt-5 pb-8">
              {/* Scoreboard overview */}
              <div className="mb-6">
                <Scoreboard goals={data.goals} onScrollTo={scrollToGoal} />
              </div>

              {/* Top risks + pass breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <TopRisks goals={data.goals} />
                <PassBreakdown events={data.events} />
              </div>

              {/* Cross-goal findings — all findings sorted by severity */}
              {allFindings.length > 0 && (
                <div className="mb-8">
                  <FindingsSection findings={allFindings} scorecard={mergedScorecard} />
                </div>
              )}

              {/* Per-goal sections */}
              <div className="mb-2">
                <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-3">
                  Per-Goal Details
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {data.goals.map(g => (
                  <GoalSection
                    key={g.id}
                    goal={g}
                    isExpanded={expandedGoals.has(g.id)}
                    onToggle={() => toggleGoal(g.id)}
                    sectionRef={(el) => {
                      if (el) sectionRefs.current.set(g.id, el);
                      else sectionRefs.current.delete(g.id);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'investigation' && runData && (
            <AnalysisView runData={runData} />
          )}

          {activeTab === 'investigation' && !runData && (
            <div className="flex-1 flex items-center justify-center p-8">
              <p className="text-sm text-tertiary-label">No investigation events available.</p>
            </div>
          )}

          {activeTab === 'cost' && (
            <div className="max-w-4xl">
              <CostTab metrics={metrics} />
              <PerGoalSummaryTable goals={data.goals} />
            </div>
          )}
        </div>
      </div>

      <CreateIssuesModal
        isOpen={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        findings={allFindings}
        repoUrl={data.repoUrl}
      />
    </div>
  );
}
