'use client';

import { useState } from 'react';
import type { Scorecard, RunMetrics, CategoryScore, ScoreLevel } from '@/lib/agentSession';
import { FindingCard } from './FindingCard';
import type { Finding } from '@/lib/runTransform';
import { scoreColor } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────

interface RunSummary {
  id: string;
  repoName: string;
  goal: string;
  startedAt: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  findings: Finding[];
}

interface DiffData {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  persistentFindings: Finding[];
  summary: string;
}

export interface CompareData {
  runA: RunSummary;
  runB: RunSummary;
  diff: DiffData;
}

interface CompareViewProps {
  data: CompareData;
}

type Tab = 'scorecard' | 'findings' | 'cost';

// ── Helpers ────────────────────────────────────────────────────

function scoreLabel(score: ScoreLevel): string {
  return score.toUpperCase();
}

const DISPLAY_NAMES: Record<string, string> = {
  stack: 'Stack & Framework',
  nextjs: 'Stack & Framework',
  'cms-integration': 'CMS Integration',
  'preview-editing': 'Preview & Editing',
  security: 'Security',
  configuration: 'Configuration',
  architecture: 'Architecture',
  routing: 'Routing',
  'data-fetching': 'Data Fetching',
  dependencies: 'Dependencies',
  deployment: 'Deployment',
  performance: 'Performance',
  accessibility: 'Accessibility',
};

function buildCategoryMap(categories: CategoryScore[]): Map<string, CategoryScore> {
  const map = new Map<string, CategoryScore>();
  for (const cat of categories) {
    const name = DISPLAY_NAMES[cat.category] ?? cat.category;
    if (!map.has(name)) map.set(name, cat);
  }
  return map;
}

const SCORE_NUMERIC: Record<string, number> = { green: 3, yellow: 2, red: 1 };

function deltaLabel(a?: ScoreLevel, b?: ScoreLevel): { text: string; color: string } {
  if (!a || !b) return { text: '--', color: 'var(--color-tertiary-label)' };
  if (a === b) return { text: '=', color: 'var(--color-tertiary-label)' };
  const diff = SCORE_NUMERIC[b] - SCORE_NUMERIC[a];
  if (diff > 0) return { text: `+${diff}`, color: 'var(--color-success)' };
  return { text: `${diff}`, color: 'var(--color-danger)' };
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

// ── Scorecard Tab ──────────────────────────────────────────────

function ScorecardTab({ data }: { data: CompareData }) {
  const { runA, runB } = data;
  const catMapA = buildCategoryMap(runA.scorecard.categories);
  const catMapB = buildCategoryMap(runB.scorecard.categories);
  const allCategories = [...new Set([...catMapA.keys(), ...catMapB.keys()])];

  const countsA = countBySeverity(runA.findings);
  const countsB = countBySeverity(runB.findings);

  return (
    <div className="max-w-[960px] pt-5 pb-8">
      {/* Overall scores */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[runA, runB].map(run => (
          <div key={run.id} className="bg-surface rounded-lg border border-separator shadow-sm p-4">
            <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-medium mb-2">
              {run.repoName}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: scoreColor(run.scorecard.overallScore) }}
                role="img"
                aria-label={`Score: ${run.scorecard.overallScore}`}
              />
              <span className="text-lg font-bold" style={{ color: scoreColor(run.scorecard.overallScore) }}>
                {scoreLabel(run.scorecard.overallScore)}
              </span>
              <span className="text-xs text-tertiary-label ml-1">
                {run.findings.length} findings
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Category comparison table */}
      <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
        Category Comparison
      </div>
      <div className="bg-surface rounded-lg border border-separator shadow-sm overflow-hidden mb-6">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-canvas text-tertiary-label text-[11px]">
              <th className="px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-left font-medium">{runA.repoName}</th>
              <th className="px-4 py-2.5 text-left font-medium">{runB.repoName}</th>
              <th className="px-4 py-2.5 text-center font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {allCategories.map(cat => {
              const scoreA = catMapA.get(cat);
              const scoreB = catMapB.get(cat);
              const delta = deltaLabel(scoreA?.score, scoreB?.score);
              return (
                <tr key={cat} className="border-t border-separator">
                  <td className="px-4 py-2.5 text-label font-medium">{cat}</td>
                  <td className="px-4 py-2.5">
                    {scoreA ? (
                      <span className="font-semibold" style={{ color: scoreColor(scoreA.score) }}>
                        {scoreLabel(scoreA.score)}
                      </span>
                    ) : (
                      <span className="text-quaternary-label">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {scoreB ? (
                      <span className="font-semibold" style={{ color: scoreColor(scoreB.score) }}>
                        {scoreLabel(scoreB.score)}
                      </span>
                    ) : (
                      <span className="text-quaternary-label">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono font-medium" style={{ color: delta.color }}>
                    {delta.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Severity breakdown */}
      <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
        Findings by Severity
      </div>
      <div className="bg-surface rounded-lg border border-separator shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-canvas text-tertiary-label text-[11px]">
              <th className="px-4 py-2.5 text-left font-medium">Severity</th>
              <th className="px-4 py-2.5 text-left font-medium">{runA.repoName}</th>
              <th className="px-4 py-2.5 text-left font-medium">{runB.repoName}</th>
            </tr>
          </thead>
          <tbody>
            {SEVERITIES.map(sev => (
              <tr key={sev} className="border-t border-separator">
                <td className="px-4 py-2.5 text-label font-medium capitalize">{sev}</td>
                <td className="px-4 py-2.5 text-secondary-label font-mono">{countsA[sev]}</td>
                <td className="px-4 py-2.5 text-secondary-label font-mono">{countsB[sev]}</td>
              </tr>
            ))}
            <tr className="border-t border-separator font-semibold">
              <td className="px-4 py-2.5 text-label">Total</td>
              <td className="px-4 py-2.5 text-label font-mono">{runA.findings.length}</td>
              <td className="px-4 py-2.5 text-label font-mono">{runB.findings.length}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Findings Tab ───────────────────────────────────────────────

function DiffSection({
  label,
  findings,
  borderColor,
  defaultOpen,
}: {
  label: string;
  findings: Finding[];
  borderColor: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (findings.length === 0) return null;

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-2 mb-2 cursor-pointer group"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`text-tertiary-label transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-semibold text-label">{label}</span>
        <span className="text-[10px] text-tertiary-label font-mono">({findings.length})</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pl-1">
          {findings.map(f => (
            <div
              key={f.id}
              className="rounded-lg pl-3"
              style={{ background: `color-mix(in srgb, ${borderColor} 8%, transparent)` }}
            >
              <FindingCard finding={f} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FindingsTab({ data }: { data: CompareData }) {
  const { diff } = data;

  return (
    <div className="max-w-[860px] pt-5 pb-8">
      <div className="bg-surface rounded-lg border border-separator shadow-sm p-3 mb-5">
        <span className="text-xs font-medium text-label">{diff.summary}</span>
        <span className="text-[10px] text-tertiary-label ml-2">
          {data.runA.repoName} vs {data.runB.repoName}
        </span>
      </div>

      <DiffSection
        label="New Findings"
        findings={diff.newFindings}
        borderColor="var(--color-success)"
        defaultOpen
      />
      <DiffSection
        label="Resolved Findings"
        findings={diff.resolvedFindings}
        borderColor="var(--color-danger)"
        defaultOpen
      />
      <DiffSection
        label="Persistent Findings"
        findings={diff.persistentFindings}
        borderColor="var(--color-separator)"
        defaultOpen={false}
      />

      {diff.newFindings.length === 0 && diff.resolvedFindings.length === 0 && diff.persistentFindings.length === 0 && (
        <div className="text-sm text-tertiary-label py-8 text-center">
          No findings in either run.
        </div>
      )}
    </div>
  );
}

// ── Cost Tab ───────────────────────────────────────────────────

function CostTab({ data }: { data: CompareData }) {
  const { runA, runB } = data;

  const stats = [
    {
      label: 'Total Cost',
      a: `$${runA.metrics.totalEstimatedCostUsd.toFixed(4)}`,
      b: `$${runB.metrics.totalEstimatedCostUsd.toFixed(4)}`,
      accent: true,
    },
    {
      label: 'Duration',
      a: `${(runA.metrics.durationMs / 1000).toFixed(1)}s`,
      b: `${(runB.metrics.durationMs / 1000).toFixed(1)}s`,
    },
    {
      label: 'Tool Calls',
      a: String(runA.metrics.toolCalls),
      b: String(runB.metrics.toolCalls),
    },
    {
      label: 'Findings',
      a: String(runA.findings.length),
      b: String(runB.findings.length),
    },
  ];

  return (
    <div className="max-w-[960px] pt-5 pb-8">
      {/* Side-by-side stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[runA, runB].map(run => (
          <div key={run.id}>
            <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
              {run.repoName}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {stats.map(s => (
                <div key={s.label} className="bg-surface rounded-lg border border-separator shadow-sm p-3">
                  <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-1">
                    {s.label}
                  </div>
                  <div className={`text-lg font-bold font-mono ${s.accent ? 'text-tint' : 'text-label'}`}>
                    {run === runA ? s.a : s.b}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Model breakdown tables */}
      {[runA, runB].map(run => {
        const modelEntries = Object.entries(run.metrics.models);
        if (modelEntries.length === 0) return null;
        return (
          <div key={run.id} className="mb-6">
            <div className="text-[10px] text-tertiary-label uppercase tracking-wide font-semibold mb-2">
              {run.repoName} — Model Breakdown
            </div>
            <div className="bg-surface rounded-lg border border-separator shadow-sm overflow-hidden">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="bg-canvas text-tertiary-label text-[11px]">
                    {['Model', 'Calls', 'Input', 'Output', 'Cost'].map(h => (
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
                      <td className="px-4 py-2.5 text-success font-medium">${info.estimatedCostUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

export function CompareView({ data }: CompareViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('scorecard');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'findings', label: 'Findings' },
    { id: 'cost', label: 'Cost' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Segmented control tab bar */}
      <div className="bg-surface shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-6 py-2.5 flex items-center">
        <div className="bg-elevated rounded-lg p-0.5 flex gap-0.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-1.5 min-w-[72px] rounded-md text-[13px] font-medium transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-surface text-label shadow-sm'
                  : 'text-secondary-label hover:text-label'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto px-6">
        <div key={activeTab} className="animate-slide-up">
          {activeTab === 'scorecard' && <ScorecardTab data={data} />}
          {activeTab === 'findings' && <FindingsTab data={data} />}
          {activeTab === 'cost' && <CostTab data={data} />}
        </div>
      </div>
    </div>
  );
}
