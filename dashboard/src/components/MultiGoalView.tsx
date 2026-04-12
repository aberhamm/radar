'use client';

import { useState } from 'react';
import type { Scorecard, RunMetrics, StepEvent } from '@/lib/agentSession';
import { transformRunData, type TransformedRunData } from '@/lib/runTransform';
import { AnalysisView } from './AnalysisView';

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
  onSelectGoal: (goalId: string, goal: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────

function scoreColor(score: string): string {
  return score === 'red' ? '#ff3b30' : score === 'yellow' ? '#ff9500' : '#34c759';
}

function scoreBg(score: string): string {
  return score === 'red'
    ? 'rgba(255,59,48,0.06)'
    : score === 'yellow'
      ? 'rgba(255,149,0,0.06)'
      : 'rgba(52,199,89,0.06)';
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

// ─── Score Matrix ───────────────────────────────────────────────

function ScoreMatrix({ goals, onSelect }: { goals: MultiGoalGoal[]; onSelect: (id: string, goal: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {goals.map(g => (
        <button
          key={g.id}
          onClick={() => onSelect(g.id, g.goal)}
          className="text-left p-4 rounded-xl border border-separator hover:border-tint hover:shadow-md transition-all cursor-pointer group"
          style={{ background: scoreBg(g.scorecard.overallScore) }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: scoreColor(g.scorecard.overallScore) }}
            />
            <span className="text-[13px] font-semibold text-label group-hover:text-tint transition-colors">
              {goalDisplayName(g.goal)}
            </span>
          </div>
          <div className="text-[11px] text-tertiary-label mb-2">
            {goalDescription(g.goal)}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-secondary-label">
            <span>{g.scorecard.overallScore.toUpperCase()}</span>
            <span>{g.scorecard.categories.length} categories</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Top Risks ──────────────────────────────────────────────────

function TopRisks({ goals }: { goals: MultiGoalGoal[] }) {
  // Deduplicate top risks across all scorecards
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

function PassBreakdown({ events }: { events: StepEvent[] }) {
  // Count events per pass by looking at pass_boundary markers
  const passes: Array<{ name: string; eventCount: number }> = [];
  let currentPass = 'Core';
  let currentCount = 0;

  for (const ev of events) {
    if (ev.action === 'pass_boundary') {
      passes.push({ name: currentPass, eventCount: currentCount });
      currentPass = (ev.result as string) ?? 'Next pass';
      currentCount = 0;
    } else if (ev.type === 'tool_call') {
      currentCount++;
    }
  }
  passes.push({ name: currentPass, eventCount: currentCount });

  const totalCalls = passes.reduce((sum, p) => sum + p.eventCount, 0);
  if (totalCalls === 0) return null;

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-label mb-3">Investigation Passes</h3>
      <div className="flex flex-col gap-2">
        {passes.map(pass => {
          const pct = totalCalls > 0 ? (pass.eventCount / totalCalls) * 100 : 0;
          return (
            <div key={pass.name} className="flex items-center gap-3">
              <span className="text-[12px] text-secondary-label w-[140px] shrink-0 truncate">
                {pass.name}
              </span>
              <div className="flex-1 h-2 bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-tint rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-tertiary-label w-[80px] text-right shrink-0">
                {pass.eventCount} calls
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

type ViewMode = 'summary' | 'investigation';

export function MultiGoalView({ data, onSelectGoal }: MultiGoalViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('summary');

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-separator shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: scoreColor(worstScore) }}
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
            <div className="mb-6">
              <h2 className="text-[15px] font-semibold text-label mb-3">Score Matrix</h2>
              <ScoreMatrix goals={data.goals} onSelect={onSelectGoal} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TopRisks goals={data.goals} />
              <PassBreakdown events={data.events} />
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
