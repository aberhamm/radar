'use client';

import { useState, useRef, useEffect } from 'react';
import type { AnimationPhase } from '@/lib/useAnimationSequence';
import type { Finding } from '@/lib/runTransform';
import { FindingCard } from '@/components/FindingCard';
import { FileTree } from '@/components/FileTree';

interface RightPanelProps {
  isOpen: boolean;
  phase: AnimationPhase;
  isLive: boolean;
  examinedFiles: string[];
  findings: Finding[];
}

export function RightPanel({
  isOpen,
  phase,
  isLive,
  examinedFiles,
  findings,
}: RightPanelProps) {
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [findingsCollapsed, setFindingsCollapsed] = useState(false);
  const filesScrollRef = useRef<HTMLDivElement>(null);
  const findingsScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll files when new files appear
  useEffect(() => {
    if (filesScrollRef.current && !filesCollapsed) {
      filesScrollRef.current.scrollTop = filesScrollRef.current.scrollHeight;
    }
  }, [examinedFiles, filesCollapsed]);

  // Auto-expand and scroll findings when new findings arrive
  useEffect(() => {
    if (findings.length > 0 && findingsCollapsed) {
      setFindingsCollapsed(false);
    }
    if (findingsScrollRef.current && !findingsCollapsed) {
      findingsScrollRef.current.scrollTo({
        top: findingsScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [findings.length, findingsCollapsed]);

  return (
    <div
      data-component="RightPanel"
      className={`border-l border-separator bg-canvas flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'w-[260px]' : 'w-0 border-l-0'}`}
    >
      <div className="w-[260px] flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Files examined */}
          <div data-component="FilesExamined" className="shrink-0">
            <button
              type="button"
              onClick={() => setFilesCollapsed((p) => !p)}
              className="w-full h-10 px-3 flex items-center justify-between cursor-pointer hover:bg-elevated/50 transition-colors border-b border-separator bg-surface"
            >
              <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">
                Files Examined
              </div>
              <div className="flex items-center gap-1.5">
                {examinedFiles.length > 0 && (
                  <span className="text-[10px] font-mono text-quaternary-label">
                    {examinedFiles.length}
                  </span>
                )}
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  className={`text-quaternary-label transition-transform duration-200 ${filesCollapsed ? '-rotate-90' : ''}`}
                >
                  <path
                    d="M2 3l2 2 2-2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </button>
            {!filesCollapsed && (
              <div
                ref={filesScrollRef}
                className="px-2 py-2 h-[200px] overflow-y-auto"
                style={{ animation: 'expand-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
              >
                <FileTree files={examinedFiles} />
              </div>
            )}
          </div>

          {/* Findings */}
          <div
            data-component="FindingsPanel"
            className="flex-1 flex flex-col overflow-hidden min-h-0"
          >
            <button
              type="button"
              onClick={() => setFindingsCollapsed((p) => !p)}
              className="w-full h-10 px-3 flex items-center justify-between cursor-pointer hover:bg-elevated/50 transition-colors border-b border-separator bg-surface"
            >
              <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">
                Findings
              </div>
              <div className="flex items-center gap-1.5">
                {findings.length > 0 && (
                  <span className="text-[10px] font-mono text-quaternary-label">
                    {findings.length}
                  </span>
                )}
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  className={`text-quaternary-label transition-transform duration-200 ${findingsCollapsed ? '-rotate-90' : ''}`}
                >
                  <path
                    d="M2 3l2 2 2-2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </button>
            {!findingsCollapsed && (
              <div
                ref={findingsScrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0"
                style={{ animation: 'expand-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
              >
                {findings.length === 0 && (phase !== 'idle' || isLive) && (
                  <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                    Findings appear after analysis
                  </div>
                )}
                {findings.length === 0 && phase === 'idle' && !isLive && (
                  <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                    &mdash;
                  </div>
                )}
                {findings.map((f, i) => (
                  <FindingCard key={`${f.id}-${i}`} finding={f} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
