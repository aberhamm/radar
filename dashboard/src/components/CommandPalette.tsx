'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus after animation frame
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div data-component="CommandPalette" className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" style={{ animation: 'fadeIn 0.15s ease both' }} />
      <div
        className="animate-scale-in relative bg-surface rounded-xl border border-separator shadow-float w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="border-b border-separator px-4 py-3 flex items-center gap-3">
          <svg className="w-4 h-4 text-tertiary-label shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-label placeholder:text-quaternary-label outline-none"
          />
          <kbd className="text-[10px] text-quaternary-label bg-elevated rounded px-1.5 py-0.5 font-mono">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-tertiary-label">
              No matching commands
            </div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => { cmd.action(); onClose(); }}
              className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors cursor-pointer ${
                i === selectedIndex
                  ? 'bg-tint text-white'
                  : 'text-label hover:bg-elevated'
              }`}
            >
              <span className="text-sm font-medium">{cmd.label}</span>
              {cmd.shortcut && (
                <kbd className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                  i === selectedIndex
                    ? 'bg-white/20 text-white/80'
                    : 'bg-elevated text-quaternary-label'
                }`}>
                  {cmd.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
