'use client';

import { useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, FileCode } from 'lucide-react';
import type { SourceFile } from '@/lib/useSourceFiles';

interface SourceFileViewerProps {
  filePath: string;
  source: SourceFile;
  highlightLines?: number[];
  onClose: () => void;
  onBack?: () => void;
  onBackdropClick?: () => void;
}

export function SourceFileViewer({
  filePath,
  source,
  highlightLines = [],
  onClose,
  onBack,
  onBackdropClick,
}: SourceFileViewerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightSet = new Set(highlightLines);
  const gutterWidth = String(source.lineCount).length;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (highlightLines.length === 0 || !scrollRef.current) return;
    const firstLine = Math.min(...highlightLines);
    const el = scrollRef.current.querySelector(`[data-line="${firstLine}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightLines]);

  const lines = source.content.split('\n');

  return (
    <>
      {/* Semi-transparent backdrop for click-outside dismissal */}
      {onBackdropClick && (
        <div
          className="absolute inset-0 z-[9] bg-black/10"
          onClick={onBackdropClick}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        data-component="SourceFileViewer"
        role="complementary"
        aria-label="Source file viewer"
        className="w-1/2 max-w-[800px] min-w-[400px] h-full border-l border-[var(--color-separator)] bg-[var(--color-surface)] flex flex-col overflow-hidden absolute right-0 top-0 z-10"
        style={{
          animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      >
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--color-separator)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] transition-colors"
                aria-label="Back to finding"
              >
                <ArrowLeft className="w-4 h-4 text-[var(--color-secondary-label)]" />
              </button>
            )}
            <FileCode className="w-4 h-4 text-[var(--color-tertiary-label)] shrink-0" />
            <span className="text-[13px] font-data text-[var(--color-label)] truncate" title={filePath}>
              {filePath}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-[var(--color-tertiary-label)] font-data">
              {source.language}
            </span>
            <span className="text-[11px] text-[var(--color-quaternary-label)] font-data tabular-nums">
              {source.lineCount} lines
            </span>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] transition-colors"
              aria-label="Close file viewer"
            >
              <X className="w-4 h-4 text-[var(--color-tertiary-label)]" />
            </button>
          </div>
        </div>
      </div>

      {/* File content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <pre className="text-[12px] font-data leading-[1.6]">
          {lines.map((line, i) => {
            const lineNum = i + 1;
            const isHighlighted = highlightSet.has(lineNum);
            return (
              <div
                key={lineNum}
                data-line={lineNum}
                className={
                  isHighlighted
                    ? 'flex border-l-2 border-[var(--color-warning)]'
                    : 'flex border-l-2 border-transparent'
                }
                style={
                  isHighlighted
                    ? { background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' }
                    : undefined
                }
              >
                <span
                  className="select-none text-right pr-4 pl-4 text-[var(--color-quaternary-label)] shrink-0"
                  style={{ minWidth: `${gutterWidth + 3}ch` }}
                >
                  {lineNum}
                </span>
                <span className="text-[var(--color-secondary-label)] pr-4 whitespace-pre">
                  {line}
                </span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
    </>
  );
}
