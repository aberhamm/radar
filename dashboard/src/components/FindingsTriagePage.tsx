'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  createColumnHelper,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  CircleDot,
  Eye,
  ExternalLink,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Search,
  Copy,
  Clipboard,
  GitPullRequestCreate,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Finding } from '@/lib/runTransform';
import type { HistoryItem } from '@/lib/agentSession';
import type { TriageStatus } from '@/lib/triageState';
import { getTriageStatuses, setTriageStatus, setTriageStatuses, countTriaged } from '@/lib/triageState';
import { buildBulkAiFixPrompt, buildBulkJiraPayload, buildBulkAdoPayload } from '@/lib/exportPayloads';
import { FindingDetailPanel } from '@/components/FindingDetailPanel';
import { CreateIssuesModal } from '@/components/CreateIssuesModal';
import { SourceFileViewer } from '@/components/SourceFileViewer';
import { useSourceFiles } from '@/lib/useSourceFiles';

// ─── Types ──────────────────────────────────────────────────────

export interface FindingsTriagePageProps {
  findings: Finding[];
  runId: string;
  repoName?: string;
  goal?: string;
  startedAt?: string;
  repoUrl?: string;
  goalLabel?: string;
  isMultiGoal?: boolean;
  goalMap?: Record<string, string>;
  availableRuns?: HistoryItem[];
  onRunSwitch?: (runId: string) => void;
  onFindingSelect?: (findingId: string | null) => void;
  selectedFindingId?: string | null;
}

function displayRepoName(name?: string, url?: string): string {
  if (url) {
    const full = url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (full.includes('/')) return full;
  }
  return name ?? '';
}

type SeverityOrder = Record<string, number>;
const SEV_ORDER: SeverityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const TRIAGE_STATUSES: TriageStatus[] = ['new', 'acknowledged', 'exported', 'fixed'];

const TRIAGE_CONFIG: Record<TriageStatus, { label: string; icon: typeof CircleDot; colorClass: string }> = {
  new: { label: 'New', icon: CircleDot, colorClass: 'text-[var(--color-info)]' },
  acknowledged: { label: 'Acknowledged', icon: Eye, colorClass: 'text-[var(--color-warning)]' },
  exported: { label: 'Exported', icon: ExternalLink, colorClass: 'text-[var(--color-tint)]' },
  fixed: { label: 'Fixed', icon: CheckCircle, colorClass: 'text-[var(--color-success)]' },
};

const SEVERITY_VARIANT: Record<string, 'critical' | 'high' | 'medium' | 'low' | 'info'> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

interface FindingRow extends Finding {
  triageStatus: TriageStatus;
  goalLabel?: string;
}

// ─── Triage dropdown ─────────────────────────────────────────────

function TriageDropdown({
  status,
  onChange,
}: {
  status: TriageStatus;
  onChange: (s: TriageStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const config = TRIAGE_CONFIG[status];
  const Icon = config.icon;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium min-h-[32px] transition-colors hover:bg-[var(--color-elevated)] cursor-pointer ${config.colorClass}`}
        aria-label={`Triage status: ${config.label}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{config.label}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] py-1 min-w-[160px] animate-scale-in">
          {TRIAGE_STATUSES.map(s => {
            const c = TRIAGE_CONFIG[s];
            const SIcon = c.icon;
            return (
              <button
                key={s}
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(s); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--color-elevated)] transition-colors cursor-pointer ${c.colorClass} ${s === status ? 'bg-[var(--color-elevated)]' : ''}`}
              >
                <SIcon className="w-3.5 h-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Filter dropdown ─────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-[var(--color-separator)] bg-[var(--color-surface)] text-[12px] text-[var(--color-secondary-label)] px-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus"
      aria-label={label}
    >
      <option value="">{label}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Stat bar ────────────────────────────────────────────────────

function StatBar({
  critical,
  high,
  total,
  triaged,
}: {
  critical: number;
  high: number;
  total: number;
  triaged: number;
}) {
  return (
    <div className="flex items-center gap-6 py-3">
      <div className="flex flex-col items-start">
        <span
          className={`text-[24px] font-bold font-brand tabular-nums leading-none ${
            critical > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-tertiary-label)]'
          }`}
        >
          {critical}
        </span>
        <span className="text-[11px] text-[var(--color-tertiary-label)] mt-1">Critical</span>
      </div>
      <div className="w-px h-8 bg-[var(--color-separator)]" />
      <div className="flex flex-col items-start">
        <span
          className={`text-[24px] font-bold font-brand tabular-nums leading-none ${
            high > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-tertiary-label)]'
          }`}
        >
          {high}
        </span>
        <span className="text-[11px] text-[var(--color-tertiary-label)] mt-1">High</span>
      </div>
      <div className="w-px h-8 bg-[var(--color-separator)]" />
      <div className="flex flex-col items-start">
        <span className="text-[24px] font-bold font-brand tabular-nums leading-none text-[var(--color-label)]">
          {total}
        </span>
        <span className="text-[11px] text-[var(--color-tertiary-label)] mt-1">Total</span>
      </div>
      <div className="w-px h-8 bg-[var(--color-separator)]" />
      <div className="flex flex-col items-start">
        <span className="text-[24px] font-bold font-brand tabular-nums leading-none text-[var(--color-tint)]">
          {triaged} <span className="text-[14px] font-normal text-[var(--color-tertiary-label)]">/ {total}</span>
        </span>
        <span className="text-[11px] text-[var(--color-tertiary-label)] mt-1">Triaged</span>
      </div>
    </div>
  );
}

// ─── Column visibility toggle ────────────────────────────────────

function ColumnToggle({
  table,
}: {
  table: ReturnType<typeof useReactTable<FindingRow>>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="h-7 px-2 rounded-md border border-[var(--color-separator)] bg-[var(--color-surface)] text-[12px] text-[var(--color-secondary-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer inline-flex items-center gap-1.5"
        aria-label="Toggle columns"
      >
        <Columns3 className="w-3.5 h-3.5" />
        Columns
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] py-1 min-w-[160px] animate-scale-in">
          {table.getAllLeafColumns().filter(c => c.id !== 'select' && c.id !== 'category' && c.id !== 'goalLabel').map(column => (
            <label
              key={column.id}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--color-secondary-label)] hover:bg-[var(--color-elevated)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
                className="rounded"
              />
              {column.id === 'triageStatus' ? 'Status' : column.id.charAt(0).toUpperCase() + column.id.slice(1)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Export menu ─────────────────────────────────────────────────

function ExportMenu({
  findings,
  onGithubExport,
  onCopy,
}: {
  findings: Finding[];
  onGithubExport: (findings: Finding[]) => void;
  onCopy: (label: string, payload: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-tint)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
      >
        <ExternalLink className="w-3 h-3" />
        Export
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] py-1 min-w-[200px] animate-scale-in">
          <button
            type="button"
            onClick={() => { onGithubExport(findings); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <GitPullRequestCreate className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            GitHub Issues
          </button>
          <button
            type="button"
            onClick={() => {
              const payload = JSON.stringify(buildBulkJiraPayload(findings), null, 2);
              onCopy(`Jira JSON for ${findings.length} finding${findings.length !== 1 ? 's' : ''} copied`, payload);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Clipboard className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy Jira JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const payload = JSON.stringify(buildBulkAdoPayload(findings), null, 2);
              onCopy(`ADO JSON for ${findings.length} finding${findings.length !== 1 ? 's' : ''} copied`, payload);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Clipboard className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy Azure DevOps JSON
          </button>
          <div className="border-t border-[var(--color-separator)]/50 my-1" />
          <button
            type="button"
            onClick={() => {
              const prompt = buildBulkAiFixPrompt(findings);
              onCopy(`AI fix prompt for ${findings.length} finding${findings.length !== 1 ? 's' : ''} copied`, prompt);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy for AI Fix
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Time-ago helper ─────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const GOAL_LABELS: Record<string, string> = {
  onboarding: 'Onboarding', audit: 'Audit', 'audit-generic': 'Generic Audit',
  migration: 'Migration', 'component-map': 'Components', 'ci-check': 'CI Check',
  'security-review': 'Security', nextjs: 'Next.js', accessibility: 'Accessibility',
  all: 'All Goals',
};

// ─── Run context header ─────────────────────────────────────────

function RunContextHeader({
  repoName,
  repoUrl,
  goal,
  startedAt,
  runId,
  availableRuns,
  onRunSwitch,
}: {
  repoName?: string;
  repoUrl?: string;
  goal?: string;
  startedAt?: string;
  runId: string;
  availableRuns?: HistoryItem[];
  onRunSwitch?: (runId: string) => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectorOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setSelectorOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectorOpen]);

  if (!repoName && !goal) return null;

  const hasMultipleRuns = availableRuns && availableRuns.length > 1;

  return (
    <div className="flex items-center gap-3 px-6 py-2.5 border-b border-[var(--color-separator)]/50 bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[13px] font-semibold text-[var(--color-label)] truncate">
          {displayRepoName(repoName, repoUrl)}
        </span>
        {goal && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-secondary-label)] font-medium shrink-0">
            {GOAL_LABELS[goal] ?? goal}
          </span>
        )}
        {startedAt && (
          <span className="text-[11px] text-[var(--color-tertiary-label)] tabular-nums shrink-0">
            {timeAgo(startedAt)}
          </span>
        )}
      </div>

      {hasMultipleRuns && (
        <div ref={ref} className="relative ml-auto shrink-0">
          <button
            type="button"
            onClick={() => setSelectorOpen(o => !o)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--color-separator)] bg-[var(--color-surface)] text-[12px] text-[var(--color-secondary-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            Switch run
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>
          {selectorOpen && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] py-1 min-w-[280px] max-h-[320px] overflow-y-auto animate-scale-in">
              {availableRuns.map(run => {
                const isActive = run.id === runId;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => { onRunSwitch?.(run.id); setSelectorOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-elevated)] transition-colors cursor-pointer ${isActive ? 'bg-[var(--color-elevated)]' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[12px] font-medium truncate ${isActive ? 'text-[var(--color-tint)]' : 'text-[var(--color-label)]'}`}>
                          {displayRepoName(run.repoName, run.repoUrl)}
                        </span>
                        <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-tertiary-label)] font-medium shrink-0">
                          {GOAL_LABELS[run.goal] ?? run.goal}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-[var(--color-tertiary-label)] tabular-nums">
                          {timeAgo(run.startedAt)}
                        </span>
                        {run.findingsCount != null && (
                          <span className="text-[11px] text-[var(--color-quaternary-label)]">
                            {run.findingsCount} finding{run.findingsCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <CheckCircle className="w-3.5 h-3.5 text-[var(--color-tint)] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

const columnHelper = createColumnHelper<FindingRow>();

export function FindingsTriagePage({
  findings,
  runId,
  repoName,
  goal,
  startedAt,
  repoUrl,
  isMultiGoal,
  goalMap,
  availableRuns,
  onRunSwitch,
  onFindingSelect,
  selectedFindingId,
}: FindingsTriagePageProps) {
  // ─── Triage state ──────────────────────────────────────────────
  const [triageStates, setTriageStates] = useState<Record<string, TriageStatus>>(() =>
    getTriageStatuses(runId, findings.map(f => f.id))
  );

  useEffect(() => {
    setTriageStates(getTriageStatuses(runId, findings.map(f => f.id)));
  }, [runId, findings]);

  const handleTriageChange = useCallback((findingId: string, status: TriageStatus) => {
    setTriageStatus(runId, findingId, status);
    setTriageStates(prev => ({ ...prev, [findingId]: status }));
  }, [runId]);

  const handleBulkTriageChange = useCallback((findingIds: string[], status: TriageStatus) => {
    const updates: Record<string, TriageStatus> = {};
    for (const id of findingIds) updates[id] = status;
    setTriageStatuses(runId, updates);
    setTriageStates(prev => ({ ...prev, ...updates }));
  }, [runId]);

  // ─── Export state ──────────────────────────────────────────────
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFindings, setExportFindings] = useState<Finding[]>([]);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const handleExport = useCallback((selected: Finding[]) => {
    setExportFindings(selected);
    setExportModalOpen(true);
  }, []);

  const handleCopyPayload = useCallback(async (label: string, payload: string) => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopyToast(label);
      setTimeout(() => setCopyToast(null), 2500);
    } catch { /* clipboard API may fail */ }
  }, []);

  // ─── Source file viewer ───────────────────────────────────────
  const [viewingFile, setViewingFile] = useState<{ filePath: string; highlightLines: number[] } | null>(null);
  const { sources, loading: sourcesLoading, load: loadSources } = useSourceFiles(runId);

  const handleViewFile = useCallback((filePath: string, highlightLine?: number) => {
    loadSources();
    setViewingFile({ filePath, highlightLines: highlightLine ? [highlightLine] : [] });
  }, [loadSources]);

  // Close file viewer when switching findings
  useEffect(() => {
    setViewingFile(null);
  }, [selectedFindingId]);

  // ─── Table data ────────────────────────────────────────────────
  const data: FindingRow[] = useMemo(() =>
    findings.map(f => ({
      ...f,
      triageStatus: triageStates[f.id] ?? 'new',
      goalLabel: goalMap?.[f.id],
    })),
    [findings, triageStates, goalMap]
  );

  // ─── Table state ───────────────────────────────────────────────
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'severity', desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => ({
    category: false,
    goalLabel: false,
  }));
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');

  // ─── Filters state ─────────────────────────────────────────────
  const [severityFilter, setSeverityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [goalFilter, setGoalFilter] = useState('');

  useEffect(() => {
    const filters: ColumnFiltersState = [];
    if (severityFilter) filters.push({ id: 'severity', value: severityFilter });
    if (categoryFilter) filters.push({ id: 'category', value: categoryFilter });
    if (statusFilter) filters.push({ id: 'triageStatus', value: statusFilter });
    if (goalFilter) filters.push({ id: 'goalLabel', value: goalFilter });
    setColumnFilters(filters);
  }, [severityFilter, categoryFilter, statusFilter, goalFilter]);

  useEffect(() => {
    setGlobalFilter(searchQuery);
  }, [searchQuery]);

  // ─── Unique filter options ─────────────────────────────────────
  const severityOptions = useMemo(() => {
    const set = new Set(findings.map(f => f.severity));
    return ['critical', 'high', 'medium', 'low', 'info']
      .filter(s => set.has(s as Finding['severity']))
      .map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));
  }, [findings]);

  const categoryOptions = useMemo(() => {
    const set = new Set(findings.map(f => f.category));
    return [...set].sort().map(c => ({ value: c, label: c.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }));
  }, [findings]);

  const goalOptions = useMemo(() => {
    if (!goalMap) return [];
    const set = new Set(Object.values(goalMap));
    return [...set].sort().map(g => ({ value: g, label: g }));
  }, [goalMap]);

  // ─── Columns ───────────────────────────────────────────────────
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          className="rounded cursor-pointer"
          aria-label="Select all findings"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          className="rounded cursor-pointer"
          aria-label={`Select ${row.original.title}`}
        />
      ),
      size: 40,
      enableSorting: false,
    }),
    columnHelper.accessor('severity', {
      header: 'Severity',
      cell: (info) => (
        <Badge variant={SEVERITY_VARIANT[info.getValue()] ?? 'info'} aria-label={`${info.getValue()} severity`}>
          {info.getValue()}
        </Badge>
      ),
      sortingFn: (a, b) => (SEV_ORDER[a.original.severity] ?? 5) - (SEV_ORDER[b.original.severity] ?? 5),
      filterFn: (row, _id, filterValue) => row.original.severity === filterValue,
      size: 100,
    }),
    // Hidden columns for filtering (not rendered in table, but filterable)
    columnHelper.accessor('category', {
      header: 'Category',
      filterFn: (row, _id, filterValue) => row.original.category === filterValue,
      size: 0,
    }),
    columnHelper.accessor('goalLabel', {
      header: 'Goal',
      filterFn: (row, _id, filterValue) => row.original.goalLabel === filterValue,
      size: 0,
    }),
    columnHelper.accessor('title', {
      header: 'Title',
      cell: (info) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-[var(--color-label)] truncate">
            {info.getValue()}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-tertiary-label)] font-medium shrink-0 whitespace-nowrap">
            {info.row.original.category.replace(/-/g, ' ')}
          </span>
          {info.row.original.goalLabel && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-tint)_8%,transparent)] text-[var(--color-tint)] font-medium shrink-0 whitespace-nowrap" style={{ opacity: 0.8 }}>
              {info.row.original.goalLabel}
            </span>
          )}
        </div>
      ),
      size: 600,
    }),
    columnHelper.accessor('triageStatus', {
      header: 'Status',
      cell: (info) => (
        <TriageDropdown
          status={info.getValue()}
          onChange={(s) => handleTriageChange(info.row.original.id, s)}
        />
      ),
      filterFn: (row, _id, filterValue) => row.original.triageStatus === filterValue,
      size: 140,
    }),
  ], [handleTriageChange]);

  // ─── Table instance ────────────────────────────────────────────
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, rowSelection, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
    initialState: {
      pagination: { pageSize: 50 },
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = (filterValue as string).toLowerCase();
      return (
        row.original.title.toLowerCase().includes(q) ||
        row.original.id.toLowerCase().includes(q) ||
        row.original.category.toLowerCase().includes(q) ||
        (row.original.note ?? '').toLowerCase().includes(q)
      );
    },
  });

  const rows = table.getRowModel().rows;
  const tableRef = useRef<HTMLTableElement>(null);

  // ─── Detail panel state ────────────────────────────────────────
  const panelOpen = selectedFindingId != null;
  const selectedFinding = useMemo(
    () => findings.find(f => f.id === selectedFindingId) ?? null,
    [findings, selectedFindingId]
  );
  const selectedFindingIndex = useMemo(() => {
    if (!selectedFindingId) return -1;
    return rows.findIndex(r => r.original.id === selectedFindingId);
  }, [selectedFindingId, rows]);


  // ─── Keyboard navigation ───────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIndex(prev => Math.min(prev + 1, rows.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'x') {
        e.preventDefault();
        const row = rows[focusedRowIndex];
        if (row) row.toggleSelected();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[focusedRowIndex];
        if (row) onFindingSelect?.(row.original.id);
      } else if (e.key === 'Escape') {
        if (panelOpen) {
          e.preventDefault();
          onFindingSelect?.(null);
        }
      } else if (e.key === '1') {
        handleStatusShortcut('new');
      } else if (e.key === '2') {
        handleStatusShortcut('acknowledged');
      } else if (e.key === '3') {
        handleStatusShortcut('exported');
      } else if (e.key === '4') {
        handleStatusShortcut('fixed');
      }
    }

    function handleStatusShortcut(status: TriageStatus) {
      const selectedIds = Object.keys(rowSelection).filter(k => rowSelection[k]);
      if (selectedIds.length > 0) {
        const findingIds = selectedIds.map(idx => rows[Number(idx)]?.original.id).filter(Boolean) as string[];
        handleBulkTriageChange(findingIds, status);
      } else {
        const row = rows[focusedRowIndex];
        if (row) handleTriageChange(row.original.id, status);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [rows, focusedRowIndex, panelOpen, rowSelection, onFindingSelect, handleTriageChange, handleBulkTriageChange]);

  // Keep focused row in view
  useEffect(() => {
    const el = tableRef.current?.querySelector(`[data-row-index="${focusedRowIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedRowIndex]);

  // ─── Stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    total: findings.length,
    triaged: countTriaged(runId, findings.map(f => f.id)),
  }), [findings, runId, triageStates]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Bulk actions ──────────────────────────────────────────────
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  // Panel navigation
  const handlePanelNav = useCallback((direction: 'prev' | 'next') => {
    const currentIdx = selectedFindingIndex;
    if (currentIdx < 0) return;
    const newIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
    if (newIdx >= 0 && newIdx < rows.length) {
      onFindingSelect?.(rows[newIdx].original.id);
      setFocusedRowIndex(newIdx);
    }
  }, [selectedFindingIndex, rows, onFindingSelect]);

  // ─── Empty state ───────────────────────────────────────────────
  if (findings.length === 0) {
    return (
      <div data-component="FindingsTriagePage" className="flex-1 flex flex-col items-center justify-center py-20 gap-4 animate-slide-up">
        <svg className="w-10 h-10 text-[var(--color-tertiary-label)]/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium text-[var(--color-secondary-label)]">No findings yet</p>
          <p className="text-[12px] text-[var(--color-tertiary-label)] mt-1">
            Findings appear here after Radar analyzes a repository.
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div data-component="FindingsTriagePage" className="flex-1 flex overflow-hidden animate-slide-up relative">
      {/* Table section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Run context */}
        <RunContextHeader
          repoName={repoName}
          repoUrl={repoUrl}
          goal={goal}
          startedAt={startedAt}
          runId={runId}
          availableRuns={availableRuns}
          onRunSwitch={onRunSwitch}
        />

        {/* Header */}
        <div className="px-6 pt-6 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl font-bold font-brand text-[var(--color-label)] tracking-tight">Findings</h1>
            <span className="text-[12px] text-[var(--color-tertiary-label)] tabular-nums">
              {rows.length} of {findings.length} shown
            </span>
          </div>
          <StatBar
            critical={stats.critical}
            high={stats.high}
            total={stats.total}
            triaged={stats.triaged}
          />
        </div>

        {/* Toolbar */}
        <div className="px-6 pb-3 flex items-center gap-2 flex-wrap shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-tertiary-label)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search findings..."
              className="h-7 rounded-md border border-[var(--color-separator)] bg-[var(--color-surface)] text-[12px] text-[var(--color-label)] pl-7 pr-2 w-48 focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus placeholder:text-[var(--color-quaternary-label)]"
              aria-label="Search findings"
            />
          </div>
          <FilterSelect label="Severity" value={severityFilter} options={severityOptions} onChange={setSeverityFilter} />
          <FilterSelect label="Category" value={categoryFilter} options={categoryOptions} onChange={setCategoryFilter} />
          <FilterSelect label="Status" value={statusFilter} options={TRIAGE_STATUSES.map(s => ({ value: s, label: TRIAGE_CONFIG[s].label }))} onChange={setStatusFilter} />
          {isMultiGoal && <FilterSelect label="Goal" value={goalFilter} options={goalOptions} onChange={setGoalFilter} />}
          <div className="ml-auto">
            <ColumnToggle table={table} />
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedCount > 0 && (
          <div className="px-6 pb-2 shrink-0 animate-slide-down">
            <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-elevated)] rounded-lg">
              <span className="text-[12px] font-medium text-[var(--color-secondary-label)]">
                {selectedCount} selected
              </span>
              <div className="flex items-center gap-1">
                {TRIAGE_STATUSES.map(s => {
                  const c = TRIAGE_CONFIG[s];
                  const SIcon = c.icon;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        const ids = Object.keys(rowSelection).filter(k => rowSelection[k]).map(idx => rows[Number(idx)]?.original.id).filter(Boolean) as string[];
                        handleBulkTriageChange(ids, s);
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium hover:bg-[var(--color-surface)] transition-colors cursor-pointer ${c.colorClass}`}
                      title={`Mark as ${c.label}`}
                    >
                      <SIcon className="w-3 h-3" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="w-px h-4 bg-[var(--color-separator)]" />
              <ExportMenu
                findings={Object.keys(rowSelection).filter(k => rowSelection[k]).map(idx => rows[Number(idx)]?.original).filter(Boolean) as Finding[]}
                onGithubExport={handleExport}
                onCopy={handleCopyPayload}
              />
              <button
                type="button"
                onClick={() => setRowSelection({})}
                className="ml-auto text-[11px] text-[var(--color-tertiary-label)] hover:text-[var(--color-secondary-label)] cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto px-6">
          <table ref={tableRef} className="w-full border-collapse" role="grid">
            <thead className="sticky top-0 z-10 bg-[var(--color-canvas)]">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      className="text-left text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider py-2 px-2 border-b border-[var(--color-separator)] select-none"
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--color-secondary-label)] transition-colors"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  data-row-index={index}
                  onClick={() => onFindingSelect?.(row.original.id)}
                  className={`cursor-pointer transition-colors ${
                    index === focusedRowIndex
                      ? 'bg-[color-mix(in_srgb,var(--color-tint)_6%,transparent)]'
                      : row.getIsSelected()
                        ? 'bg-[var(--color-elevated)]'
                        : 'hover:bg-[var(--color-elevated)]/50'
                  } ${
                    selectedFindingId === row.original.id
                      ? 'bg-[color-mix(in_srgb,var(--color-tint)_10%,transparent)]'
                      : ''
                  }`}
                  role="row"
                  aria-selected={row.getIsSelected()}
                  tabIndex={index === focusedRowIndex ? 0 : -1}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className="py-2 px-2 border-b border-[var(--color-separator)]/30 text-sm"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {table.getPageCount() > 1 && (
          <div className="px-6 py-3 flex items-center justify-between border-t border-[var(--color-separator)] shrink-0">
            <span className="text-[12px] text-[var(--color-tertiary-label)]">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-7 w-7 rounded-md border border-[var(--color-separator)] flex items-center justify-center hover:bg-[var(--color-elevated)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-7 w-7 rounded-md border border-[var(--color-separator)] flex items-center justify-center hover:bg-[var(--color-elevated)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
              </button>
            </div>
          </div>
        )}

        {/* Keyboard hints */}
        <div className="px-6 py-2 border-t border-[var(--color-separator)] flex items-center gap-4 text-[11px] text-[var(--color-quaternary-label)] shrink-0">
          <span><kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">j</kbd> <kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">k</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">x</kbd> select</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">Enter</kbd> detail</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">1-4</kbd> status</span>
          {panelOpen && <span><kbd className="px-1 py-0.5 bg-[var(--color-elevated)] rounded text-[10px] font-data">Esc</kbd> close</span>}
        </div>
      </div>

      {/* Detail panel */}
      {selectedFinding && (
        <FindingDetailPanel
          finding={selectedFinding}
          triageStatus={triageStates[selectedFinding.id] ?? 'new'}
          onTriageChange={(s) => handleTriageChange(selectedFinding.id, s)}
          onClose={() => onFindingSelect?.(null)}
          onNav={handlePanelNav}
          onGithubExport={handleExport}
          onCopy={handleCopyPayload}
          onViewFile={handleViewFile}
          currentIndex={selectedFindingIndex + 1}
          totalCount={rows.length}
          runId={runId}
        />
      )}

      {/* Source file viewer */}
      {viewingFile && (() => {
        const src = sources?.[viewingFile.filePath];
        if (sourcesLoading) {
          return (
            <div className="w-1/2 max-w-[800px] min-w-[400px] h-full border-l border-[var(--color-separator)] bg-[var(--color-surface)] flex items-center justify-center absolute right-0 top-0 z-20"
              style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
              <span className="text-[13px] text-[var(--color-tertiary-label)]">Loading source file...</span>
            </div>
          );
        }
        if (!src) {
          return (
            <div className="w-1/2 max-w-[800px] min-w-[400px] h-full border-l border-[var(--color-separator)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-3 absolute right-0 top-0 z-20"
              style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
              <span className="text-[13px] text-[var(--color-tertiary-label)]">Source not available for this run.</span>
              <button type="button" onClick={() => setViewingFile(null)}
                className="text-[12px] text-[var(--color-tint)] hover:underline">
                Go back
              </button>
            </div>
          );
        }
        return (
          <SourceFileViewer
            filePath={viewingFile.filePath}
            source={src}
            highlightLines={viewingFile.highlightLines}
            onClose={() => setViewingFile(null)}
            onBack={() => setViewingFile(null)}
            onBackdropClick={() => setViewingFile(null)}
          />
        );
      })()}

      {/* Export modal */}
      <CreateIssuesModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        findings={exportFindings}
        repoUrl={repoUrl}
      />

      {/* Copy toast */}
      {copyToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
          <div className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] px-4 py-3 min-w-[200px]">
            <div className="w-0.5 h-6 rounded-full bg-[var(--color-success)] shrink-0" />
            <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)] shrink-0" />
            <span className="text-[12px] font-medium text-[var(--color-label)]">{copyToast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
