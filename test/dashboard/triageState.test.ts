import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTriageStatus,
  setTriageStatus,
  getTriageStatuses,
  setTriageStatuses,
  countTriaged,
} from '../../dashboard/src/lib/triageState.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('triageState', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns "new" for unknown finding', () => {
    expect(getTriageStatus('run-1', 'finding-1')).toBe('new');
  });

  it('read/write roundtrip for single finding', () => {
    setTriageStatus('run-1', 'SEC-001', 'acknowledged');
    expect(getTriageStatus('run-1', 'SEC-001')).toBe('acknowledged');
  });

  it('isolates triage state per run', () => {
    setTriageStatus('run-1', 'SEC-001', 'fixed');
    setTriageStatus('run-2', 'SEC-001', 'exported');
    expect(getTriageStatus('run-1', 'SEC-001')).toBe('fixed');
    expect(getTriageStatus('run-2', 'SEC-001')).toBe('exported');
  });

  it('setting status to "new" removes the key', () => {
    setTriageStatus('run-1', 'SEC-001', 'acknowledged');
    setTriageStatus('run-1', 'SEC-001', 'new');
    const raw = JSON.parse(store['radar-triage-state']);
    expect(raw.states['run-1:SEC-001']).toBeUndefined();
  });

  it('getTriageStatuses returns batch of statuses', () => {
    setTriageStatus('run-1', 'A', 'acknowledged');
    setTriageStatus('run-1', 'B', 'fixed');
    const statuses = getTriageStatuses('run-1', ['A', 'B', 'C']);
    expect(statuses).toEqual({
      A: 'acknowledged',
      B: 'fixed',
      C: 'new',
    });
  });

  it('setTriageStatuses writes multiple at once', () => {
    setTriageStatuses('run-1', { X: 'exported', Y: 'fixed' });
    expect(getTriageStatus('run-1', 'X')).toBe('exported');
    expect(getTriageStatus('run-1', 'Y')).toBe('fixed');
  });

  it('countTriaged counts non-new statuses', () => {
    setTriageStatus('run-1', 'A', 'acknowledged');
    setTriageStatus('run-1', 'B', 'fixed');
    expect(countTriaged('run-1', ['A', 'B', 'C'])).toBe(2);
  });

  it('handles corrupt JSON gracefully', () => {
    store['radar-triage-state'] = '{not valid json!!!';
    expect(getTriageStatus('run-1', 'A')).toBe('new');
  });

  it('handles wrong schema version gracefully', () => {
    store['radar-triage-state'] = JSON.stringify({ version: 99, states: { 'run-1:A': 'fixed' } });
    expect(getTriageStatus('run-1', 'A')).toBe('new');
  });

  it('handles missing states object gracefully', () => {
    store['radar-triage-state'] = JSON.stringify({ version: 1 });
    expect(getTriageStatus('run-1', 'A')).toBe('new');
  });
});
