'use client';

import { useState } from 'react';
import { Finding, sevColor, sevBg } from '@/lib/runTransform';

const VERIFICATION_COLORS: Record<string, { text: string; bg: string; label: string }> = {
  verified: { text: 'var(--color-success)', bg: 'rgba(52,199,89,0.10)', label: 'Verified' },
  corrected: { text: 'var(--color-warning)', bg: 'rgba(255,149,0,0.10)', label: 'Corrected' },
  unverifiable: { text: 'var(--color-danger)', bg: 'rgba(255,59,48,0.10)', label: 'Unverifiable' },
};

export function FindingCard({ finding, index }: { finding: Finding; index?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = finding.evidence && finding.evidence.length > 0;
  const hasDetail = finding.note || finding.evidenceFiles.length > 0 || hasEvidence;
  const uniqueFiles = [...new Set(finding.evidenceFiles)];

  return (
    <div
      data-component="FindingCard"
      id={`finding-${finding.id}`}
      data-finding-category={finding.category ?? ''}
      className="rounded-lg overflow-hidden"
      style={{
        animation: `scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) ${(index ?? 0) * 60}ms both`,
        background: sevBg(finding.severity),
      }}
    >
      <button
        type="button"
        onClick={hasDetail ? () => setExpanded(prev => !prev) : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className={`w-full text-left p-2.5 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="text-[8px] font-bold uppercase tracking-wide rounded px-1 py-px"
            style={{ color: sevColor(finding.severity) }}
          >
            {finding.severity}
          </span>
          <span className="text-[8px] font-mono text-quaternary-label">{finding.id}</span>
          {uniqueFiles.length > 0 && (
            <span className="text-[8px] text-quaternary-label ml-auto flex items-center gap-0.5">
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                <path d="M3 2h4l3 3v5a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              {uniqueFiles.length}
            </span>
          )}
          {hasDetail && (
            <svg
              width="8" height="8" viewBox="0 0 8 8" fill="none"
              className={`shrink-0 text-quaternary-label transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div className="text-[10px] font-medium text-label leading-snug">{finding.title}</div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1.5" style={{ animation: 'fadeIn 0.15s ease both' }}>
          {finding.note && (
            <p className="text-[9px] text-secondary-label leading-relaxed italic">{finding.note}</p>
          )}
          {/* Evidence items with source context */}
          {hasEvidence && finding.evidence.map((ev, ei) => {
            const vstyle = ev.verificationStatus ? VERIFICATION_COLORS[ev.verificationStatus] : null;
            return (
              <div key={ei} className="rounded border border-separator/40 overflow-hidden">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-canvas/50">
                  <span className="text-[8px] font-mono text-tertiary-label truncate">
                    {ev.filePath}{ev.lineNumber ? `:${ev.lineNumber}` : ''}
                  </span>
                  {vstyle && (
                    <span
                      className="text-[7px] font-bold uppercase tracking-wide rounded px-1 py-px ml-auto shrink-0"
                      style={{ color: vstyle.text, background: vstyle.bg }}
                    >
                      {vstyle.label}
                    </span>
                  )}
                </div>
                {ev.description && (
                  <p className="text-[8px] text-tertiary-label px-2 py-1">{ev.description}</p>
                )}
                {ev.sourceContext && (
                  <pre className="text-[7px] font-mono text-secondary-label leading-relaxed bg-canvas/80 px-2 py-1.5 overflow-x-auto whitespace-pre border-t border-separator/30">
                    {ev.sourceContext}
                  </pre>
                )}
                {!ev.sourceContext && ev.snippet && (
                  <pre className="text-[7px] font-mono text-secondary-label leading-relaxed bg-canvas/80 px-2 py-1.5 overflow-x-auto whitespace-pre border-t border-separator/30">
                    {ev.snippet}
                  </pre>
                )}
              </div>
            );
          })}
          {/* File paths (fallback when no evidence items) */}
          {!hasEvidence && uniqueFiles.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {uniqueFiles.map((file, fi) => (
                <span key={fi} className="text-[8px] font-mono text-quaternary-label bg-canvas px-1.5 py-0.5 rounded">
                  {file}
                </span>
              ))}
            </div>
          )}
          {finding.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {finding.tags.map(tag => (
                <span key={tag} className="text-[8px] text-quaternary-label bg-canvas px-1 py-px rounded">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
