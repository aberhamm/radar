/**
 * Triage state — frontend-only, persisted in localStorage.
 * Keyed by {runId}:{findingId} so triage is per-run.
 */

export type TriageStatus = 'new' | 'acknowledged' | 'exported' | 'fixed';

const STORAGE_KEY = 'radar-triage-state';

interface TriageStore {
  version: 1;
  states: Record<string, TriageStatus>;
}

function readStore(): TriageStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, states: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && typeof parsed.states === 'object' && parsed.states !== null) {
      return parsed as TriageStore;
    }
    return { version: 1, states: {} };
  } catch {
    return { version: 1, states: {} };
  }
}

function writeStore(store: TriageStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function key(runId: string, findingId: string): string {
  return `${runId}:${findingId}`;
}

export function getTriageStatus(runId: string, findingId: string): TriageStatus {
  return readStore().states[key(runId, findingId)] ?? 'new';
}

export function setTriageStatus(runId: string, findingId: string, status: TriageStatus): void {
  const store = readStore();
  if (status === 'new') {
    delete store.states[key(runId, findingId)];
  } else {
    store.states[key(runId, findingId)] = status;
  }
  writeStore(store);
}

export function getTriageStatuses(runId: string, findingIds: string[]): Record<string, TriageStatus> {
  const store = readStore();
  const result: Record<string, TriageStatus> = {};
  for (const fid of findingIds) {
    result[fid] = store.states[key(runId, fid)] ?? 'new';
  }
  return result;
}

export function setTriageStatuses(runId: string, updates: Record<string, TriageStatus>): void {
  const store = readStore();
  for (const [findingId, status] of Object.entries(updates)) {
    if (status === 'new') {
      delete store.states[key(runId, findingId)];
    } else {
      store.states[key(runId, findingId)] = status;
    }
  }
  writeStore(store);
}

export function countTriaged(runId: string, findingIds: string[]): number {
  const store = readStore();
  let count = 0;
  for (const fid of findingIds) {
    const status = store.states[key(runId, fid)];
    if (status && status !== 'new') count++;
  }
  return count;
}
