import type { RunResult, StepEvent } from '@agent/agent/runner.js';

export type SessionStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error';

export interface RunRecord {
  id: string;
  goal: string;
  repoName: string;
  startedAt: Date;
  completedAt?: Date;
  result?: RunResult;
  events: StepEvent[];
}

export interface AgentSession {
  status: SessionStatus;
  currentRun: {
    goal: string;
    repoPath: string;
    repoName: string;
    startedAt: Date;
    events: StepEvent[];
    streamController: ReadableStreamDefaultController<Uint8Array> | null;
    budgetResolve: ((extend: boolean) => void) | null;
    abortController: AbortController | null;
  } | null;
  history: RunRecord[];
  result: RunResult | null;
}

declare global {
  var __agentSession: AgentSession | undefined;
}

function createSession(): AgentSession {
  return {
    status: 'idle',
    currentRun: null,
    history: [],
    result: null,
  };
}

export function getSession(): AgentSession {
  if (!globalThis.__agentSession) {
    globalThis.__agentSession = createSession();
  }
  return globalThis.__agentSession;
}

export function resetSession(): void {
  globalThis.__agentSession = createSession();
}
