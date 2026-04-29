'use client';

import { useState, useCallback, useRef } from 'react';

export interface SourceFile {
  content: string;
  lineCount: number;
  language: string;
}

export type SourcesMap = Record<string, SourceFile>;

export function useSourceFiles(runId: string) {
  const [sources, setSources] = useState<SourcesMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (fetchedRef.current === runId) return;
    fetchedRef.current = runId;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(runId)}/sources`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSources(data.sources ?? null);
    } catch (err) {
      setError((err as Error).message);
      fetchedRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [runId]);

  return { sources, loading, error, load };
}
