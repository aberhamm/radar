'use client';

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import type { StepEvent } from '@/lib/agentSession';
import { sevColor } from '@/lib/runTransform';

interface EventStreamProps {
  events: StepEvent[];
  onNewEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
  readonly?: boolean;
}

// ─── Grouping logic ───────────────────────────────────────────────

interface Turn {
  id: string;
  reasoning: string;
  fullReasoning?: string;
  toolCalls: StepEvent[];
  findings: StepEvent[];
  special: StepEvent[];
  timestamp?: string;
}

function groupEventsIntoTurns(events: StepEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const ev of events) {
    // Transient streaming events — superseded by text_response / tool_call
    if (ev.type === 'text_delta' || ev.type === 'tool_start') continue;

    if (ev.type === 'text_response') {
      if (current) turns.push(current);
      current = {
        id: `turn-${ev.step}-${ev.timestamp ?? ''}`,
        reasoning: ev.reasoning ?? ev.action,
        fullReasoning: ev.fullReasoning,
        toolCalls: [],
        findings: [],
        special: [],
        timestamp: ev.timestamp,
      };
      continue;
    }

    if (!current) {
      current = {
        id: `turn-implicit-${ev.step}`,
        reasoning: ev.reasoning ?? '',
        fullReasoning: ev.fullReasoning,
        toolCalls: [],
        findings: [],
        special: [],
        timestamp: ev.timestamp,
      };
    }

    if (ev.type === 'finding') {
      current.findings.push(ev);
    } else if (ev.type === 'model_switch' || ev.type === 'budget_warning' || ev.type === 'assemble_output'
               || ev.action === 'budget_plan' || ev.action === 'budget_rebalance') {
      current.special.push(ev);
    } else if (ev.action === 'detect_app_roots' || ev.action === 'detect_scope_drift' || ev.action === 'get_specialist_prompts') {
      // Infrastructure tools — skip entirely, not visible to users
    } else {
      current.toolCalls.push(ev);
    }
  }

  if (current) turns.push(current);
  return turns;
}

// ─── Finding card ─────────────────────────────────────────────────

function parseFinding(ev: StepEvent): { id: string; category: string; severity: string; title: string; description: string; evidenceCount?: number } | null {
  // Prefer structured details from Pi tool result
  const d = ev.details;
  if (d?.findingId) {
    // details has findingId + severity + evidenceCount; full content still in args
    try {
      const args = JSON.parse(ev.args ?? '{}');
      const f = args.finding ?? args;
      return {
        id: String(d.findingId),
        category: f.category ?? '',
        severity: String(d.severity ?? f.severity ?? 'info'),
        title: f.title ?? ev.action,
        description: f.description ?? '',
        evidenceCount: typeof d.evidenceCount === 'number' ? d.evidenceCount : undefined,
      };
    } catch { /* fall through */ }
  }
  // Fallback: parse from args JSON
  try {
    const args = JSON.parse(ev.args ?? '{}');
    const f = args.finding ?? args;
    return {
      id: f.id ?? '?',
      category: f.category ?? '',
      severity: f.severity ?? 'info',
      title: f.title ?? ev.action,
      description: f.description ?? '',
    };
  } catch {
    return null;
  }
}


const FindingCard = memo(function FindingCard({ event }: { event: StepEvent }) {
  const finding = useMemo(() => parseFinding(event), [event]);
  if (!finding) return null;

  return (
    <div
      className="bg-surface rounded-lg border border-separator shadow-sm p-3 mt-1.5 animate-in fade-in-0 slide-in-from-top-2 duration-300"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[10px] font-bold uppercase tracking-wide rounded-md px-2 py-0.5"
          style={{
            color: sevColor(finding.severity),
            background: `${sevColor(finding.severity)}10`,
          }}
        >
          {finding.severity}
        </span>
        <span className="text-[10px] text-tertiary-label uppercase tracking-wide">
          {finding.category}
        </span>
        {finding.evidenceCount != null && finding.evidenceCount > 0 && (
          <span className="text-[10px] text-quaternary-label">
            {finding.evidenceCount} file{finding.evidenceCount > 1 ? 's' : ''}
          </span>
        )}
        <span className="text-[10px] font-mono text-quaternary-label ml-auto">
          {finding.id}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-label mb-1">
        {finding.title}
      </div>
      <div className="text-xs text-secondary-label leading-relaxed">
        {finding.description}
      </div>
    </div>
  );
});

// ─── Dependency detection ─────────────────────────────────────────

/** Extract file paths from a tool call's args */
function extractArgPaths(args: string | undefined): string[] {
  if (!args) return [];
  try {
    const obj = JSON.parse(args);
    const paths: string[] = [];
    if (obj.path) paths.push(obj.path);
    if (obj.filePath) paths.push(obj.filePath);
    if (obj.paths && Array.isArray(obj.paths)) paths.push(...obj.paths);
    return paths.filter(Boolean);
  } catch { return []; }
}

/** Build a map of file paths → earliest step number that produced them */
function buildFileOriginMap(events: StepEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ev of events) {
    if (!ev.fullResult) continue;
    try {
      const result = JSON.parse(ev.fullResult);
      // Check common result shapes for file paths
      const paths: string[] = [];
      if (typeof result === 'object' && result !== null) {
        if (result.path) paths.push(result.path);
        if (result.files && Array.isArray(result.files)) {
          for (const f of result.files) {
            if (typeof f === 'string') paths.push(f);
            else if (f?.path) paths.push(f.path);
          }
        }
        if (result.entries && Array.isArray(result.entries)) {
          for (const e of result.entries) {
            if (typeof e === 'string') paths.push(e);
            else if (e?.path) paths.push(e.path);
            else if (e?.name) paths.push(e.name);
          }
        }
      }
      for (const p of paths) {
        if (p && !map.has(p)) map.set(p, ev.step);
      }
    } catch { /* not JSON */ }
  }
  return map;
}

// ─── Tool call chip ───────────────────────────────────────────────

function ToolDetailsBadge({ action, details }: { action: string; details: Record<string, unknown> }) {
  let label: string | null = null;
  if (action === 'grep_pattern' && typeof details.matchCount === 'number') {
    label = details.matchCount === 0 ? 'no matches' : `${details.matchCount} match${details.matchCount > 1 ? 'es' : ''}`;
  } else if (action === 'read_file' && typeof details.lineCount === 'number' && details.lineCount > 0) {
    label = `${details.lineCount} lines`;
  }
  if (!label) return null;
  return (
    <span className="text-[9px] text-quaternary-label bg-canvas rounded px-1.5 py-0.5 shrink-0">
      {label}
    </span>
  );
}

const ToolCallChip = memo(function ToolCallChip({ event, isExpanded, onToggle, backRef }: { event: StepEvent; isExpanded: boolean; onToggle: () => void; backRef?: number | null }) {
  const hasDetail = !!(event.args || event.fullResult);
  const parsedArgs = useMemo(() => {
    if (!event.args) return null;
    try { return JSON.stringify(JSON.parse(event.args), null, 2); }
    catch { return null; }
  }, [event.args]);
  const parsedResult = useMemo(() => {
    if (!event.fullResult) return null;
    try { return JSON.stringify(JSON.parse(event.fullResult), null, 2); }
    catch { return event.fullResult; }
  }, [event.fullResult]);

  return (
    <div className="flex-[1_1_auto] min-w-0">
      <button
        onClick={hasDetail ? onToggle : undefined}
        className={`flex items-center gap-1.5 w-full text-left rounded-md px-2.5 py-1.5 text-xs font-mono transition-all ${
          isExpanded
            ? 'bg-elevated border border-separator'
            : 'bg-elevated border border-transparent hover:border-separator'
        } ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-quaternary-label text-[10px] shrink-0">#{event.step}</span>
        <span className="font-medium text-label whitespace-nowrap">{event.action}</span>
        {backRef != null && (
          <span className="text-[9px] text-tertiary-label opacity-60 shrink-0">← #{backRef}</span>
        )}
        {event.details && <ToolDetailsBadge action={event.action} details={event.details} />}
        {event.result && (
          <span className="text-tertiary-label overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-[11px]">
            {event.result}
          </span>
        )}
        {hasDetail && (
          <span className="text-quaternary-label text-[10px] shrink-0 ml-auto">
            {isExpanded ? '▾' : '▸'}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 bg-elevated rounded-lg overflow-hidden text-[11px] font-mono">
          {parsedArgs && (
            <div className="border-b border-separator">
              <div className="px-3 py-1 text-[10px] text-tertiary-label font-semibold uppercase tracking-wide bg-canvas">
                Arguments
              </div>
              <pre className="px-3 py-2 m-0 text-secondary-label whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-y-auto">
                {parsedArgs}
              </pre>
            </div>
          )}
          {parsedResult && (
            <div>
              <div className="px-3 py-1 text-[10px] text-tertiary-label font-semibold uppercase tracking-wide bg-canvas">
                Result
              </div>
              <pre className="px-3 py-2 m-0 text-secondary-label whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-y-auto">
                {parsedResult}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Special event badges ─────────────────────────────────────────

const SPECIAL_EVENT_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  model_switch: { color: 'var(--color-tint)', bg: 'color-mix(in srgb, var(--color-tint) 6%, transparent)', icon: '⇄' },
  budget_warning: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 6%, transparent)', icon: '!' },
  assemble_output: { color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 6%, transparent)', icon: '✓' },
  budget_plan: { color: 'var(--color-info)', bg: 'color-mix(in srgb, var(--color-info) 6%, transparent)', icon: '▤' },
  budget_rebalance: { color: 'var(--color-accent-purple)', bg: 'color-mix(in srgb, var(--color-accent-purple) 6%, transparent)', icon: '⇋' },
};

function SpecialEvent({ event }: { event: StepEvent }) {
  const s = SPECIAL_EVENT_CONFIG[event.type ?? ''] ?? SPECIAL_EVENT_CONFIG[event.action ?? ''] ?? SPECIAL_EVENT_CONFIG.budget_warning;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mt-2 text-xs animate-in fade-in-0 slide-in-from-top-2 duration-300"
      style={{ background: s.bg }}
    >
      <span className="font-bold text-sm" style={{ color: s.color }}>{s.icon}</span>
      <span className="font-semibold" style={{ color: s.color }}>{event.action}</span>
      {event.result && (
        <span className="font-mono text-[11px] text-tertiary-label">{event.result}</span>
      )}
    </div>
  );
}

// ─── Turn card ────────────────────────────────────────────────────

type TurnStatus = 'active' | 'complete';

const STATUS_OPACITY: Record<TurnStatus, string> = {
  active: 'opacity-100',
  complete: 'opacity-75',
};

function TurnCard({ turn, turnIndex, isLatest, fileOriginMap, status, isLive }: { turn: Turn; turnIndex: number; isLatest: boolean; fileOriginMap: Map<string, number>; status: TurnStatus; isLive: boolean }) {
  const [expandedCalls, setExpandedCalls] = useState<Set<number>>(new Set());
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);

  const reasoningExpanded = manualToggle ?? (status === 'active' && isLive);

  const toggleCall = useCallback((step: number) => {
    setExpandedCalls(prev => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }, []);

  const fullText = turn.fullReasoning ?? turn.reasoning;
  const isLongReasoning = fullText.length > 150;
  const displayReasoning = reasoningExpanded
    ? fullText
    : (fullText.slice(0, 150) + (isLongReasoning ? '...' : ''));

  const batchIds = new Set(turn.toolCalls.map(tc => tc.batchId).filter(Boolean));
  const hasBatches = batchIds.size > 0;
  const isAllParallel = hasBatches && batchIds.size === 1 && turn.toolCalls.length > 1;
  const totalCalls = turn.toolCalls.length;
  const findingCount = turn.findings.length;

  // Derive a one-line decision summary from the tool calls
  const decisionSummary = useMemo(() => {
    if (totalCalls === 0) return null;
    const actions = [...new Set(turn.toolCalls.map(tc => tc.action))];
    if (actions.length <= 2) return actions.join(' → ');
    return `${actions[0]} → … → ${actions[actions.length - 1]} (${totalCalls} steps)`;
  }, [turn.toolCalls, totalCalls]);

  return (
    <div
      className={`bg-surface rounded-xl border border-separator shadow-sm p-4 hover:shadow-elevated hover:-translate-y-[1px] transition-all duration-200 ${STATUS_OPACITY[status]} ${isLatest ? 'animate-in fade-in-0 slide-in-from-bottom-3 duration-350' : ''}`}
    >
      {/* Turn header */}
      <div className={`flex gap-2.5 items-start ${(totalCalls > 0 || findingCount > 0) ? 'mb-2.5' : ''}`}>
        <span className="text-[10px] text-tertiary-label font-mono bg-elevated rounded-md px-2 py-0.5 shrink-0 mt-0.5 font-medium">
          {turnIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div
            onClick={isLongReasoning ? () => setManualToggle(!reasoningExpanded) : undefined}
            className={`text-[13px] text-label leading-relaxed ${isLongReasoning ? 'cursor-pointer' : ''}`}
          >
            {displayReasoning}
            {isLongReasoning && !reasoningExpanded && (
              <span className="text-secondary-label text-[11px] ml-1 font-medium">more</span>
            )}
          </div>

          {/* Expanded: decision summary + metadata row */}
          {reasoningExpanded && (decisionSummary || findingCount > 0) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap" style={{ animation: 'fadeIn 0.2s ease both' }}>
              {decisionSummary && (
                <span className="text-[10px] text-tertiary-label font-mono bg-canvas rounded px-2 py-0.5">
                  {decisionSummary}
                </span>
              )}
              {findingCount > 0 && (
                <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 text-danger bg-danger-subtle">
                  {findingCount} finding{findingCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-1.5">
            {totalCalls > 1 && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 ${
                isAllParallel
                  ? 'bg-elevated text-secondary-label'
                  : 'bg-elevated text-tertiary-label'
              }`}>
                {totalCalls} {isAllParallel ? 'parallel' : 'sequential'}
              </span>
            )}
            {status === 'active' && isLive && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-tint animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-tint" />
                Thinking…
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Finding count badge (always visible when turn has findings) */}
          {findingCount > 0 && !reasoningExpanded && (
            <span
              className="text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center text-danger bg-danger-subtle"
            >
              {findingCount}
            </span>
          )}
          {turn.timestamp && (
            <span className="text-[10px] text-quaternary-label font-mono whitespace-nowrap">
              {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Tool calls + findings interleaved by step order */}
      {(totalCalls > 0 || findingCount > 0) && (
        <div className="flex flex-wrap gap-1.5 ml-7">
          {[...turn.toolCalls.map(tc => ({ kind: 'tool' as const, ev: tc })),
            ...turn.findings.map(f => ({ kind: 'finding' as const, ev: f }))]
            .sort((a, b) => a.ev.step - b.ev.step)
            .map((item) => {
              if (item.kind === 'finding') {
                return (
                  <div key={`finding-${item.ev.step}`} className="w-full">
                    <FindingCard event={item.ev} />
                  </div>
                );
              }
              let backRef: number | null = null;
              const argPaths = extractArgPaths(item.ev.args);
              for (const p of argPaths) {
                const origin = fileOriginMap.get(p);
                if (origin != null && origin < item.ev.step) { backRef = origin; break; }
              }
              return (
                <ToolCallChip
                  key={`${item.ev.step}-${item.ev.action}`}
                  event={item.ev}
                  isExpanded={expandedCalls.has(item.ev.step)}
                  onToggle={() => toggleCall(item.ev.step)}
                  backRef={backRef}
                />
              );
            })}
        </div>
      )}

      {/* Special events */}
      {turn.special.length > 0 && (
        <div className="ml-7">
          {turn.special.map(s => (
            <SpecialEvent key={`special-${s.step}-${s.type}`} event={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────

export function EventStream({ events, onNewEvent, onBudgetPaused, onRunComplete, onRunError, readonly }: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const turns = useMemo(() => groupEventsIntoTurns(events), [events]);
  const fileOriginMap = useMemo(() => buildFileOriginMap(events), [events]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (readonly) return;

    const es = new EventSource('/api/events');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'budget_paused') {
          onBudgetPaused(data);
        } else if (data.type === 'budget_resumed' || data.type === 'heartbeat') {
          // Handled by page-level useEventSource
        } else if (data.type === 'run_complete') {
          onRunComplete(data.result);
          es.close();
        } else if (data.type === 'run_cancelled') {
          es.close();
        } else if (data.type === 'run_error') {
          onRunError(data.error);
          es.close();
        } else {
          onNewEvent(data as StepEvent);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {};

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly]);

  return (
    <div
      data-component="EventStream"
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto bg-canvas relative pt-3"
    >
      {events.length === 0 && (
        <div className="animate-slide-up flex flex-col items-center justify-center gap-3 pt-20 text-center">
          <div className="w-5 h-5 border-2 border-tint border-t-transparent rounded-full" style={{ animation: 'spin 0.6s linear infinite' }} />
          <div>
            <div className="text-sm font-medium text-secondary-label">Agent is starting up</div>
            <div className="text-xs text-tertiary-label mt-0.5">Events will stream in real-time</div>
          </div>
        </div>
      )}

      <div className="relative mx-4">
        {/* Timeline connector */}
        {turns.length > 1 && (
          <div className="absolute left-6 top-6 bottom-6 w-px bg-separator" />
        )}

        {turns.map((turn, i) => {
          const isLast = i === turns.length - 1;
          const isLive = !readonly;
          const turnStatus: TurnStatus = (isLast && isLive) ? 'active' : 'complete';
          return (
            <div key={turn.id} className="relative mb-2">
              {/* Timeline dot */}
              {turns.length > 1 && (
                <div className={`absolute left-6 top-5 z-10 -translate-x-1/2 w-2 h-2 rounded-full border-2 border-surface ${
                  turnStatus === 'active' ? 'bg-tint' : 'bg-separator'
                }`} />
              )}
              <div className={turns.length > 1 ? 'ml-8' : ''}>
                <TurnCard
                  turn={turn}
                  turnIndex={i}
                  isLatest={isLast}
                  fileOriginMap={fileOriginMap}
                  status={turnStatus}
                  isLive={isLive}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 bg-surface-translucent backdrop-blur-sm shadow-card rounded-full px-4 py-1.5 text-[11px] text-secondary-label cursor-pointer block mx-auto hover:shadow-elevated transition-shadow"
        >
          Resume auto-scroll
        </button>
      )}
    </div>
  );
}
