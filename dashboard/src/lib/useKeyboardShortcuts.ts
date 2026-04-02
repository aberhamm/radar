'use client';

import { useEffect } from 'react';

interface ShortcutMap {
  /** Cmd/Ctrl+N — new run */
  onNewRun?: () => void;
  /** Cmd/Ctrl+. — stop */
  onStop?: () => void;
  /** Cmd/Ctrl+K — toggle command palette */
  onTogglePalette?: () => void;
  /** Escape — close modals/palette */
  onEscape?: () => void;
  /** Space — play/pause replay */
  onPlayPause?: () => void;
  /** 1-4 — switch tabs */
  onTabSwitch?: (index: number) => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      if (meta && e.key === 'n') {
        e.preventDefault();
        shortcuts.onNewRun?.();
        return;
      }

      if (meta && e.key === '.') {
        e.preventDefault();
        shortcuts.onStop?.();
        return;
      }

      if (meta && e.key === 'k') {
        e.preventDefault();
        shortcuts.onTogglePalette?.();
        return;
      }

      if (e.key === 'Escape') {
        shortcuts.onEscape?.();
        return;
      }

      // Skip remaining shortcuts when focused on inputs
      if (isInput) return;

      if (e.key === ' ') {
        e.preventDefault();
        shortcuts.onPlayPause?.();
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4) {
        shortcuts.onTabSwitch?.(num - 1);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
