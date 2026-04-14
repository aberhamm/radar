'use client';

import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics, StepEvent } from '@/lib/agentSession';
import { transformRunData, type TransformedRunData, normalizeFindings, type Finding } from '@/lib/runTransform';
import { AnalysisView } from './AnalysisView';
import { ScorecardGrid, FindingsSection } from './CompleteView';
import { scoreColor, scoreBg, scoreToGrade } from '@/lib/utils';

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
  startedAt: string;
  completedAt?: string;
  goals: MultiGoalGoal[];
  events: StepEvent[];
  findings: unknown[];
  totalFindings: number;
}

interface MultiGoalViewProps {
  data: MultiGoalData;
}

// ─── Helpers ────────────────────────────────────────────────────

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
    for (const risk of g.scorecard.topRisks ?? []) {
      if (!seen.has(risk.id)) {
        seen.add(risk.id);
        allRisks.push(risk);
      }
    }
  }

  const sevOrder: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const sorted = allRisks
    .sort((a, b) => (sevOrder[b.severity] ?? 0) - (sevOrder[a.severity] ?? 0))
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
          <ScorecardGrid scorecard={goal.scorecard} metrics={goal.metrics} />

          {loading && (
            <div className="text-[12px] text-tertiary-label mb-4">Loading findings...</div>
          )}
          {findings && findings.length > 0 && (
            <FindingsSection findings={findings} scorecard={goal.scorecard} />
          )}
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

type ViewMode = 'summary' | 'investigation';

export function MultiGoalView({ data }: MultiGoalViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

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

  // Aggregate metrics
  const metrics = data.goals[0]?.metrics;
  const durationMs = metrics?.durationMs ?? 0;
  const toolCalls = data.events.filter(e => e.type === 'tool_call').length;
  const cost = metrics?.totalEstimatedCostUsd ?? 0;

  // Worst score across all goals
  const scoreOrder: Record<string, number> = { red: 3, yellow: 2, green: 1 };
  const worstScore = data.goals.reduce<string>((worst, g) => {
    const s = g.scorecard.overallScore;
    return (scoreOrder[s] ?? 0) > (scoreOrder[worst] ?? 0) ? s : worst;
  }, 'green');

  const toggleGoal = useCallback((goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }, []);

  const scrollToGoal = useCallback((goalId: string) => {
    // Expand the section
    setExpandedGoals(prev => new Set(prev).add(goalId));
    // Scroll into view after DOM update
    requestAnimationFrame(() => {
      sectionRefs.current.get(goalId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-separator shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: scoreColor(worstScore) }}
            role="img"
            aria-label={`Score: ${worstScore}`}
          />
          <h1 className="text-[20px] font-bold text-label">
            {data.repoName}
          </h1>
          <span className="text-[12px] font-medium text-tint bg-[rgb(0_113_227/0.08)] rounded px-2 py-0.5">
            all goals
          </span>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-secondary-label">
          <span>{data.totalFindings} findings</span>
          <span>{toolCalls} tool calls</span>
          <span>{(durationMs / 1000).toFixed(0)}s</span>
          {cost > 0 && <span>${cost.toFixed(4)}</span>}
          <span>{data.goals.length} goals scored</span>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 mt-3 bg-elevated rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setViewMode('summary')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all cursor-pointer ${
              viewMode === 'summary'
                ? 'bg-surface shadow-sm text-label'
                : 'text-secondary-label hover:text-label'
            }`}
          >
            Results
          </button>
          <button
            onClick={() => setViewMode('investigation')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all cursor-pointer ${
              viewMode === 'investigation'
                ? 'bg-surface shadow-sm text-label'
                : 'text-secondary-label hover:text-label'
            }`}
          >
            Investigation
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'summary' && (
          <div className="px-6 py-5 max-w-4xl">
            {/* Scoreboard overview */}
            <div className="mb-6">
              <h2 className="text-[15px] font-semibold text-label mb-3">Scoreboard</h2>
              <Scoreboard goals={data.goals} onScrollTo={scrollToGoal} />
            </div>

            {/* Top risks + pass breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <TopRisks goals={data.goals} />
              <PassBreakdown events={data.events} />
            </div>

            {/* Per-goal sections */}
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

        {viewMode === 'investigation' && runData && (
          <AnalysisView runData={runData} />
        )}

        {viewMode === 'investigation' && !runData && (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-tertiary-label">No investigation events available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
