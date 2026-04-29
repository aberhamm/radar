'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Tab } from '@/lib/useUrlState';
import type { RunViewMode } from '@/lib/runViewAdapters';
import { normalizeFindings, type Finding } from '@/lib/runTransform';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  copyToClipboard,
  buildReportMarkdown,
  exportReportMarkdown,
  buildMultiGoalMarkdown,
  exportMultiGoalMarkdown,
  exportReportPDF,
  exportEventsCSV,
  exportCostCSV,
  costToMarkdown,
} from '@/lib/export';
import { CostTab, ExportButton, CopiedToast } from './CompleteView';
import { RunHeader } from './RunHeader';
import { AnalysisView } from './AnalysisView';
import { CreateIssuesModal } from './CreateIssuesModal';
import { SingleOverviewContent } from './SingleOverviewContent';
import { SingleInvestigationContent } from './SingleInvestigationContent';
import { MultiOverviewContent, PerGoalSummaryTable } from './MultiOverviewContent';

// ─── Types ──────────────────────────────────────────────────────

interface RunViewProps {
  mode: RunViewMode;
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
}

// ─── Tabs ───────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'cost', label: 'Cost' },
];

// ─── Component ──────────────────────────────────────────────────

export function RunView({ mode, activeTab: controlledTab, onTabChange }: RunViewProps) {
  const [internalTab, setInternalTab] = useState<Tab>('overview');
  const activeTab = controlledTab ?? internalTab;

  const [copied, setCopied] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);

  // Single-goal: lazy-loaded findings state
  const [lazyFindings, setLazyFindings] = useState<Finding[] | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);

  // Reset lazy findings when run changes
  const prevRunKey = useRef<string | undefined>(undefined);
  const runKey = mode.kind === 'single' ? mode.data.runId : mode.data.parentId;
  if (runKey !== prevRunKey.current) {
    prevRunKey.current = runKey;
    setLazyFindings(null);
    setFindingsLoading(false);
  }

  const flash = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    if (onTabChange) onTabChange(tab);
    else setInternalTab(tab);
  }, [onTabChange]);

  // ─── Derive shared values ───────────────────────────────────

  const scorecard = mode.kind === 'single' ? mode.data.scorecard : mode.data.mergedScorecard;
  const metrics = mode.kind === 'single' ? mode.data.metrics : mode.data.metrics;
  const repoUrl = mode.kind === 'single' ? mode.data.repoUrl : mode.data.repoUrl;

  // Findings: single uses normalized findings (with lazy-load fallback), multi pre-computed
  const singleFindings: Finding[] = mode.kind === 'single'
    ? (lazyFindings ?? (mode.data.findings && mode.data.findings.length > 0 ? normalizeFindings(mode.data.findings) : []))
    : [];

  const allFindings: Finding[] = mode.kind === 'single' ? singleFindings : mode.data.findings;

  // Single-goal: lazy-load findings when slim mode returned empty array
  useEffect(() => {
    if (mode.kind !== 'single') return;
    const { runId, findings } = mode.data;
    const normalized = findings && findings.length > 0 ? normalizeFindings(findings) : [];
    if (normalized.length === 0 && !findingsLoading && !lazyFindings && runId) {
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
  }, [mode, findingsLoading, lazyFindings]);

  // ─── Header props ───────────────────────────────────────────

  const headerRepoName = mode.kind === 'single' ? scorecard.repoName : mode.data.repoName;
  const headerStats = mode.kind === 'single'
    ? [
        scorecard.categories.length + ' categories',
        allFindings.length + ' findings',
      ]
    : [
        mode.data.goals.length + ' goals',
        mode.data.totalFindings + ' findings',
      ];

  // ─── Export handlers ────────────────────────────────────────

  const handleCopyMarkdown = useCallback(async () => {
    let md: string;
    if (mode.kind === 'single') {
      md = buildReportMarkdown(mode.data.briefMarkdown, mode.data.scorecard);
    } else {
      md = buildMultiGoalMarkdown(
        mode.data.goals.map(g => ({ goal: g.goal, scorecard: g.scorecard, briefMarkdown: g.briefMarkdown })),
        mode.data.repoName,
      );
    }
    const ok = await copyToClipboard(md);
    if (ok) flash();
  }, [mode, flash]);

  const handleExportMarkdown = useCallback(() => {
    if (mode.kind === 'single') {
      exportReportMarkdown(mode.data.briefMarkdown, mode.data.scorecard);
    } else {
      exportMultiGoalMarkdown(
        mode.data.goals.map(g => ({ goal: g.goal, scorecard: g.scorecard, briefMarkdown: g.briefMarkdown })),
        mode.data.repoName,
      );
    }
  }, [mode]);

  const handleExportPDF = useCallback(async () => {
    setPdfExporting(true);
    try {
      if (mode.kind === 'single') {
        let resolvedFindings: unknown[] = mode.data.findings ?? [];
        if (resolvedFindings.length === 0 && mode.data.runId) {
          try {
            const r = await fetch(`/api/history/${encodeURIComponent(mode.data.runId)}`);
            const data = await r.json();
            if (data.result?.state?.findings) {
              resolvedFindings = data.result.state.findings;
            }
          } catch { /* proceed with empty findings */ }
        }
        await exportReportPDF(scorecard, resolvedFindings, metrics);
      } else {
        await exportReportPDF(mode.data.mergedScorecard, mode.data.findings ?? [], metrics);
      }
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setPdfExporting(false);
    }
  }, [mode, scorecard, metrics]);

  const handleExportEventsCSV = useCallback(() => {
    const events = mode.kind === 'single' ? mode.data.events : mode.data.events;
    const name = mode.kind === 'single' ? scorecard.repoName : mode.data.repoName;
    exportEventsCSV(events, name);
  }, [mode, scorecard]);

  const handleCopyCostMarkdown = useCallback(async () => {
    const ok = await copyToClipboard(costToMarkdown(metrics));
    if (ok) flash();
  }, [metrics, flash]);

  const handleExportCostCSV = useCallback(() => {
    const name = mode.kind === 'single' ? scorecard.repoName : mode.data.repoName;
    exportCostCSV(metrics, name);
  }, [mode, scorecard, metrics]);

  // Show Create Issues only when there are findings
  const showCreateIssues = mode.kind === 'single' || allFindings.length > 0;

  // Investigation: single has lazy loading, multi has pre-computed runData
  const hasInvestigationData = mode.kind === 'single' || !!mode.data.runData;

  return (
    <div data-component="RunView" className="flex-1 flex flex-col overflow-hidden">
      {/* Run header */}
      <RunHeader repoName={headerRepoName} stats={headerStats} metrics={metrics} />

      {/* Tab bar */}
      <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)} className="gap-0">
        <div className="bg-surface border-b border-separator px-6 py-2.5 flex items-center">
          <TabsList className="bg-elevated rounded-lg p-0.5 gap-0.5 h-auto">
            {TABS.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={`px-5 py-1.5 min-w-[72px] min-h-touch rounded-md text-[13px] font-medium transition-all cursor-pointer border-0 shadow-none
                  data-active:bg-surface data-active:text-[var(--color-label)] data-active:shadow-sm
                  text-[var(--color-secondary-label)] hover:text-[var(--color-label)]`}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Export actions */}
          <div className="ml-auto flex items-center gap-2">
            <CopiedToast visible={copied} />

            {activeTab === 'overview' && (
              <>
                <ExportButton label="Copy Markdown" onClick={handleCopyMarkdown} />
                <ExportButton label="Export .md" onClick={handleExportMarkdown} />
                <ExportButton
                  label={pdfExporting ? 'Exporting...' : 'Export PDF'}
                  onClick={handleExportPDF}
                />
                {showCreateIssues && (
                  <ExportButton label="Create Issues" onClick={() => setIssueModalOpen(true)} />
                )}
              </>
            )}

            {activeTab === 'investigation' && hasInvestigationData && (
              <ExportButton label="Export CSV" onClick={handleExportEventsCSV} />
            )}

            {activeTab === 'cost' && (
              <>
                <ExportButton label="Copy Markdown" onClick={handleCopyCostMarkdown} />
                <ExportButton label="Export CSV" onClick={handleExportCostCSV} />
              </>
            )}
          </div>
        </div>
      </Tabs>

      {/* Tab content */}
      <div className={`flex-1 overflow-auto flex flex-col ${activeTab === 'investigation' ? '' : 'px-6'}`}>
        <div key={activeTab} role="tabpanel" aria-label={activeTab} className="animate-slide-up flex-1 flex flex-col">

          {/* Overview */}
          {activeTab === 'overview' && mode.kind === 'single' && (
            <SingleOverviewContent
              scorecard={mode.data.scorecard}
              metrics={mode.data.metrics}
              briefMarkdown={mode.data.briefMarkdown}
              findings={singleFindings}
              findingsLoading={findingsLoading}
            />
          )}
          {activeTab === 'overview' && mode.kind === 'multi' && (
            <MultiOverviewContent
              goals={mode.data.goals}
              events={mode.data.events}
              findings={mode.data.findings}
              mergedScorecard={mode.data.mergedScorecard}
            />
          )}

          {/* Investigation */}
          {activeTab === 'investigation' && mode.kind === 'single' && (
            <SingleInvestigationContent
              runId={mode.data.runId}
              scorecard={mode.data.scorecard}
              metrics={mode.data.metrics}
              events={mode.data.events}
              findings={mode.data.findings}
              investigationRunData={mode.data.investigationRunData}
            />
          )}
          {activeTab === 'investigation' && mode.kind === 'multi' && (
            mode.data.runData ? (
              <AnalysisView runData={mode.data.runData} />
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-sm text-tertiary-label">No investigation events available.</p>
              </div>
            )
          )}

          {/* Cost */}
          {activeTab === 'cost' && (
            <div className={mode.kind === 'multi' ? 'max-w-4xl' : ''}>
              <CostTab metrics={metrics} />
              {mode.kind === 'multi' && (
                <PerGoalSummaryTable goals={mode.data.goals} />
              )}
            </div>
          )}
        </div>
      </div>

      <CreateIssuesModal
        isOpen={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        findings={allFindings}
        repoUrl={repoUrl}
      />
    </div>
  );
}
