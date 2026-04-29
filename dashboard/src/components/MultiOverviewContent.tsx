'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import type { Scorecard, StepEvent, RankedRisk, CategoryScore } from '@/lib/agentSession';
import type { Finding } from '@/lib/runTransform';
import { scoreColor, scoreBg, scoreToGrade } from '@/lib/utils';
import type { MultiGoalGoal } from '@/lib/runViewAdapters';
import { FindingCard } from './FindingCard';

// ─── Constants ─────────────────────────────────────────────────

const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };
const SEV_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

// ─── Helpers ───────────────────────────────────────────────────

export function goalDisplayName(goal: string): string {
  const names: Record<string, string> = {
    onboarding: 'Onboarding',
    audit: 'Audit',
    'audit-generic': 'Generic Audit',
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
    'audit-generic': 'Stack-agnostic assessment',
    migration: 'Upgrade path readiness',
    'component-map': 'Component inventory',
    'ci-check': 'CI pipeline health',
    'security-review': 'Security vulnerabilities',
    nextjs: 'Framework patterns',
    accessibility: 'WCAG 2.1 AA compliance',
  };
  return descs[goal] ?? '';
}

function sortGoalsWorstFirst(goals: MultiGoalGoal[]): MultiGoalGoal[] {
  return [...goals].sort((a, b) => {
    const scoreDiff = (SCORE_ORDER[b.scorecard.overallScore] ?? 0) - (SCORE_ORDER[a.scorecard.overallScore] ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return goalDisplayName(a.goal).localeCompare(goalDisplayName(b.goal));
  });
}

function sevDotColor(sev: string): string {
  switch (sev) {
    case 'critical': case 'high': return 'var(--color-danger)';
    case 'medium': return 'var(--color-warning)';
    case 'low': return 'var(--color-success)';
    default: return 'var(--color-tertiary-label)';
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function categoryMatchesFinding(scorecardCat: string, findingCat: string): boolean {
  const catSlug = slugify(scorecardCat);
  const findSlug = slugify(findingCat || 'uncategorized');
  if (catSlug === findSlug) return true;
  const catParts = catSlug.split('-');
  const findParts = findSlug.split('-');
  return findParts.every(part => catParts.includes(part));
}

function sevCounts(items: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of items) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

function findingsForCategory(findings: Finding[], categoryName: string): Finding[] {
  return findings
    .filter(f => categoryMatchesFinding(categoryName, f.category))
    .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
}

function findingsForGoal(allFindings: Finding[], goal: MultiGoalGoal): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const cat of goal.scorecard.categories) {
    for (const f of allFindings) {
      if (!seen.has(f.id) && categoryMatchesFinding(cat.category, f.category)) {
        seen.add(f.id);
        result.push(f);
      }
    }
  }
  return result.sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
}

// ─── Verdict ────────────────────────────────────────────────────

function Verdict({ goals, findings }: { goals: MultiGoalGoal[]; findings: Finding[] }) {
  const worstScore = goals.reduce((worst, g) => {
    const order: Record<string, number> = { red: 3, yellow: 2, green: 1 };
    return (order[g.scorecard.overallScore] ?? 0) > (order[worst] ?? 0)
      ? g.scorecard.overallScore : worst;
  }, 'green');

  const verdictText = worstScore === 'green'
    ? 'All goals pass. Codebase is in good shape.'
    : worstScore === 'yellow'
      ? 'Some goals need attention before production.'
      : 'Critical issues found across multiple goals.';

  return (
    <div className="flex items-start gap-5 mb-8">
      <div
        className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: scoreBg(worstScore) }}
      >
        <span
          className="text-[36px] font-bold font-brand leading-none"
          style={{ color: scoreColor(worstScore) }}
        >
          {scoreToGrade(worstScore)}
        </span>
      </div>
      <div className="pt-1 min-w-0">
        <div className="text-[17px] font-semibold text-label">
          {goals[0]?.scorecard.repoName ?? 'Repository'}
        </div>
        <div className="text-[13px] text-secondary-label mt-0.5">
          {verdictText}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-tertiary-label">
          <span>{goals.length} goals</span>
          <span className="text-quaternary-label">·</span>
          <span>{findings.length} findings</span>
        </div>
      </div>
    </div>
  );
}

// ─── Top Risks ──────────────────────────────────────────────────

function TopRisks({ goals }: { goals: MultiGoalGoal[] }) {
  const seen = new Set<string>();
  const allRisks: RankedRisk[] = [];
  for (const g of goals) {
    for (const risk of g.scorecard.topRisks ?? []) {
      if (risk.findingId && !seen.has(risk.findingId)) {
        seen.add(risk.findingId);
        allRisks.push(risk);
      }
    }
  }

  const topRisks = allRisks
    .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0))
    .slice(0, 5);

  if (topRisks.length === 0) return null;

  const sevTextColor = (s: string) =>
    s === 'critical' || s === 'high' ? 'text-danger' : s === 'medium' ? 'text-warning' : 'text-tertiary-label';

  return (
    <div className="mb-8">
      <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-3">
        Top Risks
      </div>
      <div className="flex flex-col gap-2">
        {topRisks.map((risk, i) => (
          <div key={risk.findingId} className="flex items-start gap-2.5 text-[12px]">
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
    <div className="border-t border-separator pt-6">
      <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-3">
        Investigation Passes
      </div>
      <div className="flex flex-col gap-2">
        {passes.map(pass => {
          const pct = pass.budget
            ? Math.min((pass.eventCount / pass.budget) * 100, 100)
            : totalCalls > 0 ? (pass.eventCount / totalCalls) * 100 : 0;
          const exceeded = pass.budget ? pass.eventCount >= pass.budget : false;
          const barColor = exceeded ? 'var(--color-warning)' : 'var(--color-tint)';
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

// ─── Per-Goal Summary Table (used by Cost tab) ─────────────────

export function PerGoalSummaryTable({ goals }: { goals: MultiGoalGoal[] }) {
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
                <td className="px-4 py-2.5 text-secondary-label">{g.findings.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Category Row (within a goal accordion) ────────────────────

function CategoryRow({ cat, findings, isExpanded, onToggle }: {
  cat: CategoryScore;
  findings: Finding[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const counts = sevCounts(findings);
  const hasFindingsToShow = findings.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={hasFindingsToShow ? onToggle : undefined}
        role="treeitem"
        aria-expanded={hasFindingsToShow ? isExpanded : undefined}
        className={`w-full text-left pl-4 sm:pl-6 pr-3 py-2 flex items-center gap-2 transition-colors ${
          hasFindingsToShow ? 'hover:bg-elevated/50 cursor-pointer' : 'cursor-default'
        }`}
      >
        {hasFindingsToShow && (
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="none"
            className={`shrink-0 text-tertiary-label transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          >
            <path d="M3 2l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {!hasFindingsToShow && <span className="w-2 shrink-0" />}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: scoreColor(cat.score) }}
        />
        <span className="text-[12px] text-secondary-label flex-1 truncate">
          {cat.category}
        </span>
        <span
          className="text-[10px] font-bold uppercase shrink-0"
          style={{ color: scoreColor(cat.score) }}
        >
          {cat.score}
        </span>
        {hasFindingsToShow && (
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
        )}
        <span className="text-[10px] text-tertiary-label ml-1 shrink-0">
          {findings.length}
        </span>
      </button>
      {isExpanded && hasFindingsToShow && (
        <div className="pl-8 sm:pl-12 pr-3 pb-2 space-y-1.5">
          {findings.map((f, i) => (
            <FindingCard key={`${f.id}-${i}`} finding={f} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Goal Accordion Section ────────────────────────────────────

function GoalAccordionSection({
  goal,
  distributedFindings,
  isExpanded,
  onToggle,
  sectionRef,
  expandedCategories,
  onToggleCategory,
}: {
  goal: MultiGoalGoal;
  distributedFindings: Finding[];
  isExpanded: boolean;
  onToggle: () => void;
  sectionRef: (el: HTMLDivElement | null) => void;
  expandedCategories: Set<string>;
  onToggleCategory: (catKey: string) => void;
}) {
  const gradeColor = scoreColor(goal.scorecard.overallScore);
  const catPrefix = `${goal.id}::`;

  return (
    <div
      ref={sectionRef}
      data-component={`GoalAccordion-${goal.goal}`}
      className="rounded-xl border border-separator overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        role="treeitem"
        aria-expanded={isExpanded}
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
            {distributedFindings.length} findings
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

      {isExpanded && (
        <div className="border-t border-separator/50" role="group">
          {goal.scorecard.categories.map(cat => {
            const catFindings = findingsForCategory(distributedFindings, cat.category);
            const catKey = `${catPrefix}${cat.category}`;
            return (
              <CategoryRow
                key={cat.category}
                cat={cat}
                findings={catFindings}
                isExpanded={expandedCategories.has(catKey)}
                onToggle={() => onToggleCategory(catKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Overview Content ──────────────────────────────────────

interface MultiOverviewContentProps {
  goals: MultiGoalGoal[];
  events: StepEvent[];
  findings: Finding[];
  mergedScorecard: Scorecard;
}

export function MultiOverviewContent({ goals, events, findings }: MultiOverviewContentProps) {
  const sorted = useMemo(() => sortGoalsWorstFirst(goals), [goals]);

  const goalFindingsMap = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const g of sorted) {
      map.set(g.id, findingsForGoal(findings, g));
    }
    return map;
  }, [sorted, findings]);

  // Auto-expand: worst goal + its worst category
  const worstGoal = sorted[0];
  const worstCatKey = useMemo(() => {
    if (!worstGoal) return null;
    const cats = worstGoal.scorecard.categories;
    const worstCat = cats.reduce<CategoryScore | null>((worst, c) => {
      if (!worst) return c;
      return (SCORE_ORDER[c.score] ?? 0) > (SCORE_ORDER[worst.score] ?? 0) ? c : worst;
    }, null);
    return worstCat ? `${worstGoal.id}::${worstCat.category}` : null;
  }, [worstGoal]);

  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (worstGoal) initial.add(worstGoal.id);
    return initial;
  });

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (worstCatKey) initial.add(worstCatKey);
    return initial;
  });

  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  const toggleGoal = useCallback((goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((catKey: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey);
      else next.add(catKey);
      return next;
    });
  }, []);

  const allExpanded = expandedGoals.size === sorted.length;
  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedGoals(new Set());
      setExpandedCategories(new Set());
    } else {
      setExpandedGoals(new Set(sorted.map(g => g.id)));
    }
  }, [allExpanded, sorted]);

  return (
    <div data-component="MultiOverviewContent" className="max-w-[860px] pt-5 pb-8">
      {/* Level 1: The Verdict */}
      <Verdict goals={sorted} findings={findings} />

      {/* Level 2: Top Risks */}
      <TopRisks goals={sorted} />

      {/* Level 3: Per-Goal Details */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold">
            Goals ({sorted.length})
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-tint hover:text-tint-hover transition-colors cursor-pointer"
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </div>

        <div data-component="GoalAccordion" role="tree" className="flex flex-col gap-1.5">
          {sorted.map(g => (
            <GoalAccordionSection
              key={g.id}
              goal={g}
              distributedFindings={goalFindingsMap.get(g.id) ?? []}
              isExpanded={expandedGoals.has(g.id)}
              onToggle={() => toggleGoal(g.id)}
              sectionRef={(el) => {
                if (el) sectionRefs.current.set(g.id, el);
                else sectionRefs.current.delete(g.id);
              }}
              expandedCategories={expandedCategories}
              onToggleCategory={toggleCategory}
            />
          ))}
        </div>
      </div>

      {/* Level 4: Investigation Passes */}
      <PassBreakdown events={events} />
    </div>
  );
}
