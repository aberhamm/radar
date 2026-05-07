'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Finding } from '@/lib/runTransform';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ModalState = 'form' | 'creating' | 'done' | 'error';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface IssueCreationResult {
  findingId: string;
  fingerprint: string;
  title: string;
  status: 'created' | 'skipped_duplicate' | 'skipped_severity' | 'error';
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
}

interface CreateIssuesResult {
  results: IssueCreationResult[];
  summary: {
    created: number;
    skippedDuplicate: number;
    skippedSeverity: number;
    errored: number;
  };
}

interface CreateIssuesModalProps {
  isOpen: boolean;
  onClose: () => void;
  findings: Finding[];
  repoUrl?: string;
}

const SEV_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function parseGitHubRepo(url?: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

function countBySeverity(findings: Finding[], threshold: Severity): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const sev = f.severity as Severity;
    if ((SEV_ORDER[sev] ?? 0) >= (SEV_ORDER[threshold] ?? 0)) {
      counts[sev] = (counts[sev] ?? 0) + 1;
    }
  }
  return counts;
}

export function CreateIssuesModal({ isOpen, onClose, findings, repoUrl }: CreateIssuesModalProps) {
  const parsed = parseGitHubRepo(repoUrl);
  const [owner, setOwner] = useState(parsed?.owner ?? '');
  const [repo, setRepo] = useState(parsed?.repo ?? '');
  const [threshold, setThreshold] = useState<Severity>('medium');
  const [state, setState] = useState<ModalState>('form');
  const [result, setResult] = useState<CreateIssuesResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const p = parseGitHubRepo(repoUrl);
      setOwner(p?.owner ?? '');
      setRepo(p?.repo ?? '');
      setThreshold(findings.length === 1 ? 'info' : 'medium');
      setState('form');
      setResult(null);
      setErrorMsg('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, repoUrl, findings.length]);

  const eligibleCount = findings.filter(
    f => (SEV_ORDER[f.severity as Severity] ?? 0) >= (SEV_ORDER[threshold] ?? 0),
  ).length;

  const sevBreakdown = countBySeverity(findings, threshold);

  const handleCreate = useCallback(async () => {
    if (!owner || !repo) return;
    setState('creating');
    setErrorMsg('');

    try {
      const rawFindings = findings.map(f => ({
        id: f.id,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        title: f.title,
        description: f.note,
        evidence: f.evidence.map(ev => ({
          filePath: ev.filePath,
          lineNumber: ev.lineNumber,
          snippet: ev.snippet,
          description: ev.description,
          verificationStatus: ev.verificationStatus,
          sourceContext: ev.sourceContext,
          originalSnippet: ev.originalSnippet,
        })),
        tags: f.tags,
        fingerprint: f.fingerprint,
      }));

      const res = await fetch('/api/create-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          repo,
          findings: rawFindings,
          severityThreshold: threshold,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data: CreateIssuesResult = await res.json();
      setResult(data);
      setState('done');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState('error');
    }
  }, [owner, repo, threshold, findings]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        data-component="CreateIssuesModal"
        className="bg-[var(--color-surface)] border-[var(--color-separator)] shadow-[var(--shadow-float)] sm:max-w-md p-0 gap-0 rounded-xl"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="border-b border-[var(--color-separator)] px-5 py-4 flex-row items-center justify-between">
          <DialogTitle className="text-[15px] font-semibold text-[var(--color-label)]">
            Create GitHub Issues
          </DialogTitle>
          <button
            onClick={onClose}
            className="text-[var(--color-tertiary-label)] hover:text-[var(--color-label)] transition-colors p-1 -mr-1 rounded-md hover:bg-[var(--color-elevated)] cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </DialogHeader>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {state === 'form' && (
            <>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-[var(--color-secondary-label)]">Target repository</label>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={owner}
                    onChange={e => setOwner(e.target.value)}
                    placeholder="owner"
                    className="flex-1 min-w-0 bg-[var(--color-elevated)] rounded-md px-3 py-2 text-[13px] text-[var(--color-label)] placeholder:text-[var(--color-quaternary-label)] border border-[var(--color-separator)]/60 outline-none focus:border-[var(--color-tint)]"
                  />
                  <span className="text-[var(--color-quaternary-label)] self-center">/</span>
                  <input
                    type="text"
                    value={repo}
                    onChange={e => setRepo(e.target.value)}
                    placeholder="repo"
                    className="flex-1 min-w-0 bg-[var(--color-elevated)] rounded-md px-3 py-2 text-[13px] text-[var(--color-label)] placeholder:text-[var(--color-quaternary-label)] border border-[var(--color-separator)]/60 outline-none focus:border-[var(--color-tint)]"
                  />
                </div>
              </div>

              {findings.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[var(--color-secondary-label)]">Minimum severity</label>
                  <select
                    value={threshold}
                    onChange={e => setThreshold(e.target.value as Severity)}
                    className="w-full bg-[var(--color-elevated)] rounded-md px-3 py-2 text-[13px] text-[var(--color-label)] border border-[var(--color-separator)]/60 outline-none focus:border-[var(--color-tint)] cursor-pointer"
                  >
                    <option value="critical">Critical only</option>
                    <option value="high">High and above</option>
                    <option value="medium">Medium and above</option>
                    <option value="low">Low and above</option>
                    <option value="info">All findings</option>
                  </select>
                </div>
              )}

              <div className="bg-[var(--color-elevated)] rounded-lg px-4 py-3 text-[12px] text-[var(--color-secondary-label)]">
                {findings.length === 1 ? (
                  <>
                    <span className="font-medium text-[var(--color-label)]">{findings[0].title}</span>
                    <p className="mt-1 text-[var(--color-tertiary-label)]">{findings[0].severity} / {findings[0].category}</p>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[var(--color-label)]">{eligibleCount}</span> issue{eligibleCount !== 1 ? 's' : ''} will be created
                    {Object.keys(sevBreakdown).length > 0 && (
                      <span className="ml-1.5">
                        ({Object.entries(sevBreakdown)
                          .sort(([a], [b]) => (SEV_ORDER[b as Severity] ?? 0) - (SEV_ORDER[a as Severity] ?? 0))
                          .map(([sev, count]) => `${count} ${sev}`)
                          .join(', ')})
                      </span>
                    )}
                    <p className="mt-1 text-[var(--color-tertiary-label)]">Duplicates will be skipped automatically via fingerprint matching.</p>
                  </>
                )}
              </div>
            </>
          )}

          {state === 'creating' && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-[var(--color-tint)] border-t-transparent rounded-full animate-spin" />
              <p className="text-[13px] text-[var(--color-secondary-label)]">Creating issues...</p>
            </div>
          )}

          {state === 'done' && result && (
            <div className="space-y-3">
              <div className="bg-[var(--color-elevated)] rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-[var(--color-success)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span className="text-[13px] font-medium text-[var(--color-label)]">
                    {result.summary.created} issue{result.summary.created !== 1 ? 's' : ''} created
                  </span>
                </div>
                {result.summary.skippedDuplicate > 0 && (
                  <p className="text-[12px] text-[var(--color-tertiary-label)]">{result.summary.skippedDuplicate} duplicate{result.summary.skippedDuplicate !== 1 ? 's' : ''} skipped</p>
                )}
                {result.summary.errored > 0 && (
                  <p className="text-[12px] text-[var(--color-danger)]">{result.summary.errored} failed</p>
                )}
              </div>

              <div className="max-h-48 overflow-auto space-y-1">
                {result.results
                  .filter(r => r.status === 'created' && r.issueUrl)
                  .map(r => (
                    <a
                      key={r.findingId}
                      href={r.issueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-elevated)] text-[12px] transition-colors group"
                    >
                      <span className="text-[var(--color-tint)] font-mono">#{r.issueNumber}</span>
                      <span className="text-[var(--color-label)] truncate flex-1">{r.title}</span>
                      <svg className="w-3 h-3 text-[var(--color-quaternary-label)] group-hover:text-[var(--color-tint)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ))}
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="py-4">
              <div className="bg-danger-subtle rounded-lg px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-danger)]">Failed to create issues</p>
                <p className="text-[12px] text-[var(--color-danger)]/80 mt-1">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-[var(--color-separator)] bg-transparent px-5 py-3 mx-0 mb-0 rounded-b-xl flex-row justify-end gap-2">
          {state === 'form' && (
            <>
              <Button variant="ghost" onClick={onClose} className="text-[13px] text-[var(--color-secondary-label)]">
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!owner || !repo || eligibleCount === 0}
                className="bg-[var(--color-tint)] text-white hover:opacity-90 text-[13px]"
              >
                Create {eligibleCount} Issue{eligibleCount !== 1 ? 's' : ''}
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <Button variant="ghost" onClick={() => setState('form')} className="text-[13px] text-[var(--color-secondary-label)]">
                Back
              </Button>
              <Button
                onClick={handleCreate}
                className="bg-[var(--color-tint)] text-white hover:opacity-90 text-[13px]"
              >
                Retry
              </Button>
            </>
          )}
          {state === 'done' && (
            <Button
              onClick={onClose}
              className="bg-[var(--color-tint)] text-white hover:opacity-90 text-[13px]"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
