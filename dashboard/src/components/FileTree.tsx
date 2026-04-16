'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { pathsToTree, type FileNode } from '@/lib/pathsToTree';

// ─── Icon map ──────────────────────────────────────────────────

const ICON_MAP: Record<string, { color: string; icon: string }> = {
  tsx: { color: 'text-[oklch(0.65_0.18_220)]', icon: '\u269B' },   // ⚛
  ts:  { color: 'text-[oklch(0.6_0.15_230)]',  icon: '\u25C6' },   // ◆
  jsx: { color: 'text-[oklch(0.7_0.2_200)]',   icon: '\u269B' },   // ⚛
  js:  { color: 'text-[oklch(0.8_0.18_90)]',   icon: '\u25C6' },   // ◆
  css: { color: 'text-[oklch(0.65_0.2_280)]',  icon: '\u25C8' },   // ◈
  json:{ color: 'text-[oklch(0.75_0.15_85)]',  icon: '{}' },
  md:  { color: 'text-tertiary-label',          icon: '\u25CA' },   // ◊
  svg: { color: 'text-[oklch(0.7_0.15_160)]',  icon: '\u25D0' },   // ◐
  png: { color: 'text-[oklch(0.65_0.12_160)]', icon: '\u25D1' },   // ◑
  jpg: { color: 'text-[oklch(0.65_0.12_160)]', icon: '\u25D1' },
  yaml:{ color: 'text-[oklch(0.7_0.12_50)]',   icon: '\u25C7' },   // ◇
  yml: { color: 'text-[oklch(0.7_0.12_50)]',   icon: '\u25C7' },
  env: { color: 'text-warning',                 icon: '\u25C7' },
  config: { color: 'text-tertiary-label',       icon: '\u2699' },   // ⚙
};
const DEFAULT_ICON = { color: 'text-tertiary-label', icon: '\u25C7' }; // ◇

function getFileIcon(extension?: string) {
  return ICON_MAP[extension || ''] || DEFAULT_ICON;
}

// ─── File item (recursive) ────────────────────────────────────

function FileItem({ node, depth }: { node: FileNode; depth: number }) {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const [isHovered, setIsHovered] = useState(false);

  const isFolder = node.type === 'folder';
  const hasChildren = isFolder && node.children && node.children.length > 0;
  const fileIcon = getFileIcon(node.extension);

  return (
    <div className="select-none">
      <div
        className={cn(
          'group relative flex items-center gap-1.5 py-[3px] px-1.5 rounded cursor-pointer',
          'transition-colors duration-150',
          isHovered && 'bg-elevated',
        )}
        onClick={() => isFolder && setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {/* Tree connector */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${(depth - 1) * 12 + 12}px` }}
          >
            <div className={cn(
              'w-px h-full transition-colors duration-150',
              isHovered ? 'bg-tint/30' : 'bg-separator/40',
            )} />
          </div>
        )}

        {/* Chevron / file icon */}
        <div
          className={cn(
            'flex items-center justify-center w-3 h-3 shrink-0 transition-transform duration-150',
            isFolder && isOpen && 'rotate-90',
          )}
        >
          {isFolder ? (
            <svg width="5" height="7" viewBox="0 0 6 8" fill="none"
              className={cn('transition-colors duration-150', isHovered ? 'text-tint' : 'text-tertiary-label')}
            >
              <path d="M1 1L5 4L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className={cn('text-[8px] leading-none', fileIcon.color)}>{fileIcon.icon}</span>
          )}
        </div>

        {/* Folder / file glyph */}
        <div className={cn(
          'flex items-center justify-center w-3.5 h-3.5 shrink-0 transition-all duration-150',
          isFolder
            ? (isHovered ? 'text-warning' : 'text-warning/70')
            : (isHovered ? cn(fileIcon.color, 'opacity-100') : cn(fileIcon.color, 'opacity-60')),
        )}>
          {isFolder ? (
            <svg width="11" height="10" viewBox="0 0 16 14" fill="currentColor">
              <path d="M1.5 1C0.671573 1 0 1.67157 0 2.5V11.5C0 12.3284 0.671573 13 1.5 13H14.5C15.3284 13 16 12.3284 16 11.5V4.5C16 3.67157 15.3284 3 14.5 3H8L6.5 1H1.5Z" />
            </svg>
          ) : (
            <svg width="10" height="12" viewBox="0 0 14 16" fill="currentColor" opacity="0.7">
              <path d="M1.5 0C0.671573 0 0 0.671573 0 1.5V14.5C0 15.3284 0.671573 16 1.5 16H12.5C13.3284 16 14 15.3284 14 14.5V4.5L9.5 0H1.5Z" />
              <path d="M9 0V4.5H14" fill="currentColor" fillOpacity="0.4" />
            </svg>
          )}
        </div>

        {/* Name */}
        <span className={cn(
          'font-mono text-[9px] leading-tight truncate transition-colors duration-150',
          isFolder
            ? (isHovered ? 'text-label' : 'text-secondary-label')
            : (isHovered ? 'text-label' : 'text-tertiary-label'),
        )}>
          {node.name}
        </span>

        {/* Child count for folders */}
        {isFolder && node.children && (
          <span className="text-[8px] text-quaternary-label ml-auto shrink-0">
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isOpen && (
        <div
          className="overflow-hidden"
          style={{ animation: 'expand-down 0.15s cubic-bezier(0.16, 1, 0.3, 1) both' }}
        >
          {node.children!.map((child, i) => (
            <FileItem key={`${child.type}-${child.name}-${i}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FileTree (public) ────────────────────────────────────────

interface FileTreeProps {
  /** Flat array of file paths (e.g. ["src/tools/foo.ts", "package.json"]) */
  files: string[];
  className?: string;
}

export function FileTree({ files, className }: FileTreeProps) {
  const tree = useMemo(() => pathsToTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className={cn('text-[10px] text-quaternary-label text-center py-1', className)}>
        &mdash;
      </div>
    );
  }

  return (
    <div data-component="FileTree" className={cn('space-y-px', className)}>
      {tree.map((node, i) => (
        <FileItem key={`${node.type}-${node.name}-${i}`} node={node} depth={0} />
      ))}
    </div>
  );
}
