'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  ChevronUp,
  ChevronDown,
  CircleDot,
  Eye,
  ExternalLink,
  Check,
  CheckCircle,
  Copy,
  FileCode,
  Clipboard,
  GitPullRequestCreate,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Finding, EvidenceItem } from '@/lib/runTransform';
import type { TriageStatus } from '@/lib/triageState';
import { buildAiFixPrompt, buildJiraPayload, buildAdoPayload } from '@/lib/exportPayloads';

// ─── Constants ──────────────────────────────────────────────────

const SEVERITY_VARIANT: Record<string, 'critical' | 'high' | 'medium' | 'low' | 'info'> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

const TRIAGE_STATUSES: TriageStatus[] = ['new', 'acknowledged', 'exported', 'fixed'];

const TRIAGE_CONFIG: Record<TriageStatus, { label: string; icon: typeof CircleDot; colorClass: string }> = {
  new: { label: 'New', icon: CircleDot, colorClass: 'text-[var(--color-info)]' },
  acknowledged: { label: 'Acknowledged', icon: Eye, colorClass: 'text-[var(--color-warning)]' },
  exported: { label: 'Exported', icon: ExternalLink, colorClass: 'text-[var(--color-tint)]' },
  fixed: { label: 'Fixed', icon: CheckCircle, colorClass: 'text-[var(--color-success)]' },
};

// ─── Props ──────────────────────────────────────────────────────

export interface FindingDetailPanelProps {
  finding: Finding;
  triageStatus: TriageStatus;
  onTriageChange: (status: TriageStatus) => void;
  onClose: () => void;
  onNav: (direction: 'prev' | 'next') => void;
  onGithubExport?: (findings: Finding[]) => void;
  onCopy?: (label: string, payload: string) => void;
  onViewFile?: (filePath: string, highlightLine?: number) => void;
  currentIndex: number;
  totalCount: number;
  runId: string;
}

// ─── Code snippet ────────────────────────────────────────────────

function CodeSnippet({ evidence, onViewFile }: { evidence: EvidenceItem; onViewFile?: (filePath: string, highlightLine?: number) => void }) {
  return (
    <div className="rounded-lg bg-[var(--color-elevated)] border border-[var(--color-separator)]/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-separator)]/30">
        {onViewFile ? (
          <button
            type="button"
            onClick={() => onViewFile(evidence.filePath, evidence.lineNumber)}
            className="text-[11px] font-data text-[var(--color-tint)] truncate hover:underline cursor-pointer text-left"
            title="View full file"
          >
            {evidence.filePath}
            {evidence.lineNumber ? `:${evidence.lineNumber}` : ''}
          </button>
        ) : (
          <span className="text-[11px] font-data text-[var(--color-tertiary-label)] truncate">
            {evidence.filePath}
            {evidence.lineNumber ? `:${evidence.lineNumber}` : ''}
          </span>
        )}
        {evidence.verificationStatus && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            evidence.verificationStatus === 'verified'
              ? 'text-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]'
              : evidence.verificationStatus === 'corrected'
                ? 'text-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)]'
                : 'text-[var(--color-tertiary-label)] bg-[var(--color-elevated)]'
          }`}>
            {evidence.verificationStatus}
          </span>
        )}
      </div>
      {evidence.snippet && (
        <pre className="px-3 py-2 text-[12px] font-data text-[var(--color-label)] overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {evidence.snippet}
        </pre>
      )}
      {evidence.sourceContext && !evidence.snippet && (
        <pre className="px-3 py-2 text-[12px] font-data text-[var(--color-secondary-label)] overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {evidence.sourceContext}
        </pre>
      )}
      {evidence.description && (
        <div className="px-3 py-2 border-t border-[var(--color-separator)]/30 text-[12px] text-[var(--color-secondary-label)]">
          {evidence.description}
        </div>
      )}
    </div>
  );
}

// ─── Export dropdown ────────────────────────────────────────────

function ExportDropdown({ finding, onGithubExport, onCopy }: { finding: Finding; onGithubExport?: (findings: Finding[]) => void; onCopy?: (label: string, payload: string) => void }) {
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

  const copyPayload = useCallback(async (label: string, payload: string) => {
    if (onCopy) {
      onCopy(label, payload);
    } else {
      try { await navigator.clipboard.writeText(payload); } catch { /* */ }
    }
    setOpen(false);
  }, [onCopy]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 h-7 rounded-md border border-[var(--color-separator)] px-2.5 text-[11px] font-medium text-[var(--color-secondary-label)] cursor-pointer hover:bg-[var(--color-elevated)] active:scale-[0.98] transition-all"
      >
        <ExternalLink className="w-3 h-3" />
        Export
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-50 bg-[var(--color-surface)] border border-[var(--color-separator)] rounded-lg shadow-[var(--shadow-elevated)] py-1 min-w-[200px]" style={{ animation: 'scaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
          {onGithubExport && (
            <button
              type="button"
              onClick={() => { onGithubExport([finding]); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
            >
              <GitPullRequestCreate className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
              Create GitHub Issue
            </button>
          )}
          <button
            type="button"
            onClick={() => copyPayload('Jira JSON copied', JSON.stringify(buildJiraPayload(finding), null, 2))}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Clipboard className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy Jira JSON
          </button>
          <button
            type="button"
            onClick={() => copyPayload('ADO JSON copied', JSON.stringify(buildAdoPayload(finding), null, 2))}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Clipboard className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy Azure DevOps JSON
          </button>
          <div className="border-t border-[var(--color-separator)]/50 my-1" />
          <button
            type="button"
            onClick={() => copyPayload('AI fix prompt copied', buildAiFixPrompt(finding))}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--color-label)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-[var(--color-secondary-label)]" />
            Copy AI Fix Prompt
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────

export function FindingDetailPanel({
  finding,
  triageStatus,
  onTriageChange,
  onClose,
  onNav,
  onGithubExport,
  onCopy,
  onViewFile,
  currentIndex,
  totalCount,
}: FindingDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);

  // Focus panel title on open
  useEffect(() => {
    titleRef.current?.focus();
  }, [finding.id]);

  // Keyboard nav within panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        onNav('next');
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        onNav('prev');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNav, onClose]);

  const handleCopyAiFix = useCallback(async () => {
    const md = buildAiFixPrompt(finding);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API might fail in some environments
    }
  }, [finding]);

  const statusConfig = TRIAGE_CONFIG[triageStatus];
  const StatusIcon = statusConfig.icon;

  const evidenceWithSnippets = finding.evidence.filter(e => e.snippet || e.sourceContext || e.description);
  const affectedFiles = [...new Set(finding.evidenceFiles)];

  return (
    <div
      ref={panelRef}
      data-component="FindingDetailPanel"
      role="complementary"
      aria-label="Finding detail"
      className="w-1/2 max-w-[680px] min-w-[360px] h-full border-l border-[var(--color-separator)] bg-[var(--color-surface)] flex flex-col overflow-hidden absolute right-0 top-0 z-10"
      style={{
        animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
    >
      {/* Panel header */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--color-separator)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[finding.severity] ?? 'info'}>
              {finding.severity}
            </Badge>
            <span className="text-[12px] text-[var(--color-tertiary-label)] font-data tabular-nums">
              {String(currentIndex).padStart(2, '0')} / {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onNav('prev')}
              disabled={currentIndex <= 1}
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--color-elevated)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous finding"
              title="Previous (K)"
            >
              <ChevronUp className="w-4 h-4 text-[var(--color-secondary-label)]" />
            </button>
            <button
              type="button"
              onClick={() => onNav('next')}
              disabled={currentIndex >= totalCount}
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--color-elevated)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next finding"
              title="Next (J)"
            >
              <ChevronDown className="w-4 h-4 text-[var(--color-secondary-label)]" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--color-elevated)] transition-colors cursor-pointer ml-1"
              aria-label="Close panel"
              title="Close (Esc)"
            >
              <X className="w-4 h-4 text-[var(--color-secondary-label)]" />
            </button>
          </div>
        </div>
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="text-[15px] font-semibold text-[var(--color-label)] leading-snug outline-none"
        >
          {finding.title}
        </h2>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-secondary-label)] font-medium">
            {finding.category.replace(/-/g, ' ')}
          </span>
          <span className="text-[11px] font-data text-[var(--color-tertiary-label)]">
            {finding.id}
          </span>
        </div>
      </div>

      {/* Panel content (scrollable) */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {/* Description / investigation note */}
        {finding.note && (
          <section>
            <h3 className="text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider mb-2">
              Description
            </h3>
            <p className="text-[13px] text-[var(--color-secondary-label)] leading-relaxed">
              {finding.note}
            </p>
          </section>
        )}

        {/* Evidence / code snippets */}
        {evidenceWithSnippets.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider mb-2">
              Evidence
            </h3>
            <div className="flex flex-col gap-2">
              {evidenceWithSnippets.map((e, i) => (
                <CodeSnippet key={`${e.filePath}-${i}`} evidence={e} onViewFile={onViewFile} />
              ))}
            </div>
          </section>
        )}

        {/* Affected files */}
        {affectedFiles.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider mb-2">
              Affected Files
            </h3>
            <div className="flex flex-col gap-1">
              {affectedFiles.map(f => (
                <div key={f} className="flex items-center gap-2 py-1">
                  <FileCode className="w-3.5 h-3.5 text-[var(--color-tertiary-label)] shrink-0" />
                  {onViewFile ? (
                    <button
                      type="button"
                      onClick={() => onViewFile(f)}
                      className="text-[12px] font-data text-[var(--color-tint)] truncate hover:underline cursor-pointer text-left"
                      title="View full file"
                    >
                      {f}
                    </button>
                  ) : (
                    <span className="text-[12px] font-data text-[var(--color-secondary-label)] truncate">
                      {f}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tags */}
        {finding.tags.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider mb-2">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1">
              {finding.tags.map(t => (
                <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-tertiary-label)]">
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Confidence */}
        {finding.confidence != null && (
          <section>
            <h3 className="text-[11px] font-semibold text-[var(--color-tertiary-label)] uppercase tracking-wider mb-2">
              Confidence
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-[var(--color-elevated)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-tint)] transition-all duration-300"
                  style={{ width: `${(finding.confidence / 10) * 100}%` }}
                />
              </div>
              <span className="text-[12px] font-data text-[var(--color-secondary-label)] tabular-nums">
                {finding.confidence}/10
              </span>
            </div>
          </section>
        )}
      </div>

      {/* Panel footer (sticky) */}
      <div className="shrink-0 px-4 py-2.5 border-t border-[var(--color-separator)] flex items-center gap-1.5">
        {/* Status toggle */}
        <div className="flex items-center gap-0.5 bg-[var(--color-elevated)] rounded-md p-0.5">
          {TRIAGE_STATUSES.map(s => {
            const c = TRIAGE_CONFIG[s];
            const SIcon = c.icon;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onTriageChange(s)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  s === triageStatus
                    ? `${c.colorClass} bg-[var(--color-surface)] shadow-sm`
                    : 'text-[var(--color-tertiary-label)] hover:text-[var(--color-secondary-label)]'
                }`}
                title={c.label}
              >
                <SIcon className="w-3 h-3" />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <ExportDropdown
            finding={finding}
            onGithubExport={onGithubExport}
            onCopy={onCopy}
          />
          <button
            type="button"
            onClick={handleCopyAiFix}
            className={`h-7 rounded-md flex items-center justify-center cursor-pointer active:scale-[0.97] transition-all duration-150 ${
              copied
                ? 'bg-[var(--color-success)] gap-1 px-2.5'
                : 'bg-[var(--color-tint)] w-7 hover:brightness-110'
            } text-white`}
            title="Copy as markdown"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Copied</span>
              </>
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
