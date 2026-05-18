'use client';

import { useState, useCallback } from 'react';
import { config } from './dashboardConfig';

export type SpecialistDisplayMode = 'inline' | 'modal' | 'panel';

const STORAGE_KEY = 'radar-specialist-display';

function isValidMode(v: unknown): v is SpecialistDisplayMode {
  return v === 'inline' || v === 'modal' || v === 'panel';
}

export function useSpecialistDisplayMode(): [SpecialistDisplayMode, (m: SpecialistDisplayMode) => void] {
  const [mode, setModeState] = useState<SpecialistDisplayMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isValidMode(stored)) return stored;
    } catch {}
    return isValidMode(config.specialistDisplay) ? config.specialistDisplay : 'inline';
  });

  const setMode = useCallback((next: SpecialistDisplayMode) => {
    setModeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  return [mode, setMode];
}
