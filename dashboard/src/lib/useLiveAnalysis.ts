'use client';

import { useMemo } from 'react';
import type { StepEvent } from './agentSession';
import type { AnimationPhase } from './useAnimationSequence';
import type { Activity, Finding, StreamTurn } from './runTransform';
import { ACTION_CATEGORY_HINTS, cleanReasoning } from './runTransform';

/** Live progress state for the current record_finding execution. */
export interface FindingProgressState {
  findingIndex: number;
  findingTotal: number;
  findingId: string;
  phase: 'verifying_evidence' | 'evidence_verified' | 'finding_recorded';
  evidenceIndex?: number;
  evidenceTotal?: number;
  evidenceStatus?: string;
  evidenceFile?: string;
}

export interface WorkerState {
  clusterId: string;
  name: string;
  color: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  budget: number;
  toolCalls: number;
  findingsCount: number;
  currentActivity: string;
}

export interface SpecialistState {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'skipped';
  toolCalls: number;
  budget: number;
  findingsCount: number;
  currentActivity: string;
  color: string;
}

export interface LiveAnalysisState {
  phase: AnimationPhase;
  turns: StreamTurn[];
  typingText: string;
  activeTurnIndex: number | null;
  coveredTopics: Set<string>;
  examinedFiles: string[];
  findings: Finding[];
  scoreVisible: boolean;
  progressPercent: number;
  /** Tool names currently executing (tool_start received, tool_call not yet) */
  pendingActions: string[];
  /** Startup/status message (loading agent, pre-computation, pass boundaries) */
  statusMessage: string;
  /** Live sub-progress during record_finding execution */
  findingProgress: FindingProgressState | null;
  /** Parallel mode: worker states keyed by clusterId */
  workers: Map<string, WorkerState> | null;
  /** Parallel mode: currently selected worker for detail view */
  selectedWorkerId: string | null;
  /** Parallel mode: synthesis pass status */
  synthesisStatus: 'pending' | 'running' | 'complete' | null;
  /** Whether this run is using parallel dispatch */
  isParallel: boolean;
  /** Specialist mode: specialist states keyed by specialistId */
  specialists: Map<string, SpecialistState> | null;
  /** Specialist mode: currently selected specialist for detail view (null = Core) */
  selectedSpecialistId: string | null;
  /** Specialist mode: per-specialist turns for modal/panel display */
  specialistTurns: Map<string, StreamTurn[]>;
}

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/**
 * Parse a finding from a StepEvent and merge/dedup into the findings array.
 * Handles JSON parse, dedup by category + 50% evidence file overlap, severity merge, evidence merge.
 */
export function parseFinding(ev: StepEvent, findings: Finding[]): void {
  try {
    const args = ev.args ? JSON.parse(ev.args) : {};
    let f = args.finding ?? args;
    if (typeof f === 'string') f = JSON.parse(f);
    if (!f || typeof f !== 'object' || !f.title) return;
    const incoming: Finding = {
      id: f.id ?? `f-${findings.length}`,
      severity: f.severity ?? 'info',
      category: f.category ?? '',
      title: f.title ?? ev.action,
      evidenceFiles: (f.evidence ?? []).map((e: { filePath: string }) => e.filePath),
      evidence: (f.evidence ?? []).map((e: { filePath: string; lineNumber?: number; snippet?: string; description?: string; verificationStatus?: string; sourceContext?: string; originalSnippet?: string }) => ({
        filePath: e.filePath,
        lineNumber: e.lineNumber,
        snippet: e.snippet ?? '',
        description: e.description ?? '',
        verificationStatus: e.verificationStatus,
        sourceContext: e.sourceContext,
        originalSnippet: e.originalSnippet,
      })),
      note: f.investigationNote ?? f.description ?? '',
      tags: f.tags ?? [],
    };
    const incomingPaths = new Set(incoming.evidenceFiles);
    const dupIdx = findings.findIndex((existing) => {
      if (existing.category !== incoming.category) return false;
      const existPaths = new Set(existing.evidenceFiles);
      if (incomingPaths.size === 0 && existPaths.size === 0) return false;
      let inter = 0;
      for (const p of incomingPaths) if (existPaths.has(p)) inter++;
      const union = new Set([...incomingPaths, ...existPaths]).size;
      return union > 0 && inter / union >= 0.5;
    });
    if (dupIdx !== -1) {
      const existing = findings[dupIdx];
      const keepSeverity = (SEV_RANK[existing.severity] ?? 0) >= (SEV_RANK[incoming.severity] ?? 0)
        ? existing.severity : incoming.severity;
      const seenEvPaths = new Set(existing.evidenceFiles.map((ef, i) => `${ef}:${existing.evidence[i]?.lineNumber ?? 'none'}`));
      const mergedEvidence = [...existing.evidence];
      const mergedEvFiles = [...existing.evidenceFiles];
      for (let ei = 0; ei < incoming.evidence.length; ei++) {
        const key = `${incoming.evidenceFiles[ei]}:${incoming.evidence[ei]?.lineNumber ?? 'none'}`;
        if (!seenEvPaths.has(key)) {
          seenEvPaths.add(key);
          mergedEvidence.push(incoming.evidence[ei]);
          mergedEvFiles.push(incoming.evidenceFiles[ei]);
        }
      }
      findings[dupIdx] = {
        ...existing,
        severity: keepSeverity,
        note: existing.note.length >= incoming.note.length ? existing.note : incoming.note,
        evidence: mergedEvidence,
        evidenceFiles: mergedEvFiles,
        tags: [...new Set([...existing.tags, ...incoming.tags])],
      };
    } else {
      findings.push(incoming);
    }
  } catch { /* parse error */ }
}

const SPECIALIST_META: Record<string, { name: string; color: string }> = {
  'nextjs-specialist': { name: 'Next.js Specialist', color: '#0070f3' },
  'a11y-specialist': { name: 'Accessibility Specialist', color: '#8b5cf6' },
};

/**
 * Derives AnalysisView-compatible state from live SSE events.
 *
 * Groups events into turns as they arrive:
 * - text_response → becomes typingText until tool_calls follow
 * - tool_calls → commit the reasoning + activities as a turn
 * - switch_to_fast_model → inserts switch divider
 * - record_finding → adds to findings list
 * - assemble_output → transitions to assembling phase
 */
export function useLiveAnalysis(
  events: StepEvent[],
  eventsVersion: number,
  runStatus: string,
  toolCalls: number,
  budget: number,
  selectedWorkerOverride?: string | null,
  selectedSpecialistOverride?: string | null,
): LiveAnalysisState {
  return useMemo(() => {
    const turns: StreamTurn[] = [];
    let currentReasoning = '';
    let currentActivities: Activity[] = [];
    let currentPhase: 'analyze' | 'write' = 'analyze';
    let currentWorkerId: string | undefined = undefined;
    const coveredTopics = new Set<string>();
    const examinedFilesSet = new Set<string>();
    const findings: Finding[] = [];
    let switchSeen = false;
    let assembleOutputSeen = false;
    let pendingDeltaText = ''; // accumulates text_delta content for live typing
    let pendingDeltaWorkerId: string | undefined = undefined;
    let statusMessage = '';
    let findingProgress: FindingProgressState | null = null;
    let workers: Map<string, WorkerState> | null = null;
    let selectedWorkerId: string | null = null;
    let synthesisStatus: 'pending' | 'running' | 'complete' | null = null;
    let isParallel = false;

    // Per-worker accumulators — only used in parallel mode.
    // Each worker gets its own reasoning/activities/delta state so interleaved
    // events from different workers never stomp each other.
    interface WorkerAccum {
      turns: StreamTurn[];
      currentReasoning: string;
      currentActivities: Activity[];
      currentPhase: 'analyze' | 'write';
      pendingDeltaText: string;
      switchSeen: boolean;
    }
    const workerAccum = new Map<string, WorkerAccum>();
    function getAccum(wid: string): WorkerAccum {
      let a = workerAccum.get(wid);
      if (!a) {
        a = { turns: [], currentReasoning: '', currentActivities: [], currentPhase: 'analyze', pendingDeltaText: '', switchSeen: false };
        workerAccum.set(wid, a);
      }
      return a;
    }

    // Per-specialist accumulators — used in sequential multi-goal mode.
    interface SpecialistAccum {
      turns: StreamTurn[];
      currentReasoning: string;
      currentActivities: Activity[];
      pendingDeltaText: string;
    }
    const specialistAccum = new Map<string, SpecialistAccum>();
    const specialistBudgets = new Map<string, number>();
    let specialists: Map<string, SpecialistState> | null = null;
    let selectedSpecialistId: string | null = null;

    function getSpecAccum(sid: string): SpecialistAccum {
      let a = specialistAccum.get(sid);
      if (!a) {
        a = { turns: [], currentReasoning: '', currentActivities: [], pendingDeltaText: '' };
        specialistAccum.set(sid, a);
      }
      return a;
    }

    for (const ev of events) {
      // Startup status events (loading agent, starting analysis)
      if (ev.type === 'status' && ev.result) {
        statusMessage = String(ev.result);
        continue;
      }

      // Budget plan (multi-goal sequential: before first pass)
      if (ev.action === 'budget_plan' && ev.result) {
        turns.push({ reasoning: 'Budget plan computed from repo signals', activities: [{ label: 'budget_plan', files: [], detail: ev.result }], phase: 'analyze' });
        statusMessage = 'Budget allocated — starting Core pass...';
        continue;
      }

      // Cluster plan (parallel mode: initializes worker states)
      if (ev.action === 'cluster_plan' && ev.result) {
        isParallel = true;
        workers = new Map();
        try {
          const plan = JSON.parse(ev.result as string);
          for (const c of (plan.clusters ?? [])) {
            workers.set(c.clusterId, {
              clusterId: c.clusterId,
              name: c.name,
              color: c.color,
              status: c.skip ? 'complete' : 'pending',
              budget: c.budget,
              toolCalls: 0,
              findingsCount: 0,
              currentActivity: c.skip ? `Skipped: ${c.skipReason ?? ''}` : '',
            });
            if (!selectedWorkerId && !c.skip) selectedWorkerId = c.clusterId;
          }
          synthesisStatus = 'pending';
        } catch { /* parse error */ }
        turns.push({ reasoning: 'Cluster budget plan computed — dispatching parallel workers', activities: [{ label: 'cluster_plan', files: [], detail: ev.result as string }], phase: 'analyze' });
        statusMessage = `Dispatching ${workers?.size ?? 0} parallel workers...`;
        continue;
      }

      // Worker complete (parallel mode)
      if (ev.action === 'worker_complete' && ev.workerId && workers) {
        const w = workers.get(ev.workerId);
        if (w) {
          try {
            const data = JSON.parse(ev.result as string);
            w.status = 'complete';
            w.toolCalls = data.toolCalls ?? w.toolCalls;
            w.findingsCount = data.findings ?? w.findingsCount;
            w.currentActivity = 'Complete';
          } catch { w.status = 'complete'; }
        }
        // Flush any remaining state in this worker's accumulator
        if (isParallel) {
          const acc = workerAccum.get(ev.workerId);
          if (acc && acc.currentReasoning) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: acc.currentPhase, workerId: ev.workerId });
            acc.currentReasoning = '';
            acc.currentActivities = [];
          }
        }
        const total = workers.size;
        const done = [...workers.values()].filter(w => w.status === 'complete').length;
        statusMessage = `${done}/${total} workers complete`;
        continue;
      }

      // Synthesis events (parallel mode)
      if (ev.action === 'synthesis_start') {
        synthesisStatus = 'running';
        statusMessage = 'Synthesis: cross-referencing findings...';
        continue;
      }
      if (ev.action === 'synthesis_complete') {
        synthesisStatus = 'complete';
        statusMessage = 'Synthesis complete';
        continue;
      }

      // Track worker activity from worker-tagged events
      if (ev.workerId && workers && ev.workerId !== 'synthesis') {
        const w = workers.get(ev.workerId);
        if (w) {
          if (w.status === 'pending') w.status = 'running';
          if (ev.type === 'tool_call') w.toolCalls++;
          if (ev.action === 'record_finding') w.findingsCount++;
          if (ev.type === 'tool_start' && ev.action) {
            w.currentActivity = ev.action;
          }
        }
      }

      // ── Parallel mode: route event into per-worker accumulator ──
      if (isParallel && ev.workerId && ev.workerId !== 'synthesis') {
        const wid = ev.workerId;
        const acc = getAccum(wid);

        // Model switch
        if (ev.action === 'switch_to_fast_model' || ev.type === 'model_switch') {
          if (!acc.switchSeen) {
            if (acc.currentReasoning) {
              acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: acc.currentPhase, workerId: wid });
            }
            acc.turns.push({ reasoning: '', activities: [], phase: 'analyze', isSwitch: true, workerId: wid });
            acc.currentReasoning = '';
            acc.currentActivities = [];
            acc.currentPhase = 'write';
            acc.switchSeen = true;
          }
          switchSeen = true;
          continue;
        }

        // Finding sub-progress
        if (ev.type === 'finding_progress' && ev.details) {
          const d = ev.details as Record<string, unknown>;
          findingProgress = {
            findingIndex: (d.findingIndex as number) ?? 0,
            findingTotal: (d.findingTotal as number) ?? 0,
            findingId: (d.findingId as string) ?? '',
            phase: (d.phase as FindingProgressState['phase']) ?? 'verifying_evidence',
            evidenceIndex: d.evidenceIndex as number | undefined,
            evidenceTotal: d.evidenceTotal as number | undefined,
            evidenceStatus: d.evidenceStatus as string | undefined,
            evidenceFile: d.evidenceFile as string | undefined,
          };
          continue;
        }

        // Findings (shared across all workers — not per-worker)
        if (ev.type === 'finding' || ev.action === 'record_finding') {
          parseFinding(ev, findings);
          const existing = acc.currentActivities.find(a => a.label === 'record_finding');
          if (existing) existing.pending = false;
          findingProgress = null;
          continue;
        }

        // Assemble output
        if (ev.type === 'assemble_output' || ev.action === 'assemble_output') {
          assembleOutputSeen = true;
        }

        // Verification
        if (ev.type === 'verification' && ev.result) {
          if (acc.currentReasoning && acc.currentActivities.length > 0) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: acc.currentPhase, workerId: wid });
            acc.currentReasoning = '';
            acc.currentActivities = [];
          }
          acc.turns.push({
            reasoning: String(ev.result),
            activities: [{ label: ev.action ?? 'post_process', files: [], detail: '' }],
            phase: 'write',
            workerId: wid,
          });
          continue;
        }

        // Text delta — per-worker
        if (ev.type === 'text_delta' && ev.reasoning) {
          if (!acc.switchSeen) acc.pendingDeltaText = ev.reasoning;
          continue;
        }

        // Clear status once real investigation events arrive
        if (statusMessage && (ev.type === 'text_response' || ev.type === 'tool_call')) {
          statusMessage = '';
        }

        // Text response — per-worker turn boundary
        const reasoning = ev.fullReasoning ?? ev.reasoning;
        if (ev.type === 'text_response' && reasoning) {
          if (acc.switchSeen) continue;
          if (acc.currentReasoning) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: acc.currentPhase, workerId: wid });
          }
          acc.currentReasoning = reasoning;
          acc.currentActivities = [];
          acc.pendingDeltaText = '';
          continue;
        }

        // Tool start — per-worker
        if (ev.type === 'tool_start' && ev.action) {
          if (acc.pendingDeltaText || acc.currentReasoning) {
            const text = acc.pendingDeltaText || acc.currentReasoning;
            if (text && acc.currentActivities.length === 0) {
              acc.currentReasoning = text;
              acc.pendingDeltaText = '';
            }
          }
          const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
          let files: string[] = [];
          let detail = '';
          try {
            const args = ev.args ? JSON.parse(ev.args) : {};
            if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
            if (args.paths) files = args.paths;
            if (args.filePath) files = [args.filePath];
            if (args.pattern) detail = args.pattern;
          } catch { /* parse error */ }
          files = files.filter(f => f && f !== '.');
          const existing = acc.currentActivities.find(a => a.label === ev.action);
          if (existing) { existing.files.push(...files); }
          else { acc.currentActivities.push({ label: ev.action, files, detail, pending: true }); }
          files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));
          const hints = ACTION_CATEGORY_HINTS[ev.action];
          if (hints) hints.forEach(c => coveredTopics.add(c));
          continue;
        }

        // Tool call — per-worker
        if (ev.type === 'tool_call' && ev.action) {
          const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
          let files: string[] = [];
          let detail = '';
          try {
            const args = ev.args ? JSON.parse(ev.args) : {};
            if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
            if (args.paths) files = args.paths;
            if (args.filePath) files = [args.filePath];
            if (args.pattern) detail = args.pattern;
            if (args.packages) detail = Object.keys(args.packages).join(', ');
          } catch { /* parse error */ }
          files = files.filter(f => f && f !== '.');
          const existing = acc.currentActivities.find(a => a.label === ev.action);
          if (existing) { existing.files.push(...files); existing.pending = false; }
          else { acc.currentActivities.push({ label: ev.action, files, detail }); }
          files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));
          const hints = ACTION_CATEGORY_HINTS[ev.action];
          if (hints) hints.forEach(c => coveredTopics.add(c));
        }

        continue; // All worker events handled above
      }

      // ── Non-parallel (single-worker) event processing ──

      // Budget rebalance (multi-goal sequential: after core, before specialists)
      if (ev.action === 'budget_rebalance' && ev.result) {
        try {
          const rb = JSON.parse(ev.result as string);
          for (const p of (rb.adjustedPasses ?? [])) {
            if (p.name?.includes('Next.js')) specialistBudgets.set('nextjs-specialist', p.budget ?? 0);
            if (p.name?.includes('Accessibility')) specialistBudgets.set('a11y-specialist', p.budget ?? 0);
          }
        } catch { /* parse error */ }
        turns.push({ reasoning: 'Specialist budgets adjusted based on core findings', activities: [{ label: 'budget_rebalance', files: [], detail: ev.result }], phase: 'analyze' });
        statusMessage = 'Budgets rebalanced — starting specialist passes...';
        continue;
      }

      // Pass boundary (multi-goal: between investigation passes)
      if (ev.action === 'pass_boundary' && ev.result) {
        if (currentReasoning) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase, workerId: currentWorkerId });
        }
        currentReasoning = '';
        currentActivities = [];
        currentWorkerId = undefined;
        statusMessage = `Running ${ev.result} pass...`;

        // Initialize specialist state from pass_boundary (specialist names)
        const passName = ev.result as string;
        const isSkipped = passName.includes('(skipped)');
        let matchedSid: string | undefined;
        for (const [sid, meta] of Object.entries(SPECIALIST_META)) {
          if (passName.includes(meta.name.replace(' Specialist', ''))) {
            if (!specialists) specialists = new Map();
            specialists.set(sid, {
              id: sid,
              name: meta.name,
              status: isSkipped ? 'skipped' : 'running',
              toolCalls: 0,
              budget: specialistBudgets.get(sid) ?? 0,
              findingsCount: 0,
              currentActivity: isSkipped ? 'Skipped' : '',
              color: meta.color,
            });
            if (!isSkipped && selectedSpecialistId === null) {
              selectedSpecialistId = sid;
            }
            matchedSid = sid;
          }
        }

        if (matchedSid && specialists) {
          const meta = specialists.get(matchedSid)!;
          turns.push({
            reasoning: '',
            activities: [],
            phase: 'analyze',
            isSpecialistStart: true,
            specialistId: matchedSid,
            specialistName: meta.name,
            specialistColor: meta.color,
            specialistStatus: meta.status,
          });
        } else {
          turns.push({ reasoning: `Starting ${ev.result} pass`, activities: [], phase: 'analyze', isPassBoundary: true, passName: ev.result as string });
        }
        continue;
      }

      // Pass complete (multi-goal: specialist pass finished)
      if (ev.action === 'pass_complete' && ev.result && specialists) {
        let passName = '';
        let parsedToolCalls: number | undefined;
        let parsedBudget: number | undefined;
        try {
          const data = JSON.parse(ev.result as string);
          passName = data.pass as string ?? '';
          parsedToolCalls = data.toolCalls;
          parsedBudget = data.budget;
        } catch {
          passName = String(ev.result);
        }
        // Resolve target specialist: prefer tagged specialistId, fall back to name matching
        const targetSids: string[] = [];
        if (ev.specialistId && SPECIALIST_META[ev.specialistId]) {
          targetSids.push(ev.specialistId);
        } else {
          for (const [sid, meta] of Object.entries(SPECIALIST_META)) {
            if (passName.includes(meta.name.replace(' Specialist', ''))) {
              targetSids.push(sid);
            }
          }
        }
        for (const sid of targetSids) {
          const spec = specialists.get(sid);
          if (spec) {
            spec.status = 'complete';
            if (parsedToolCalls !== undefined) spec.toolCalls = parsedToolCalls;
            if (parsedBudget !== undefined) spec.budget = parsedBudget;
            spec.currentActivity = 'Complete';
          }
          const acc = specialistAccum.get(sid);
          if (acc && acc.currentReasoning) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: 'analyze' });
            acc.currentReasoning = '';
            acc.currentActivities = [];
          }
          // Update the specialist start turn's status to 'complete'
          const startTurn = turns.find(t => t.isSpecialistStart && t.specialistId === sid);
          if (startTurn) startTurn.specialistStatus = 'complete';
        }
        continue;
      }

      // ── Specialist event routing (events tagged with specialistId) ──
      if (ev.specialistId && specialists) {
        const sid = ev.specialistId;
        const spec = specialists.get(sid);
        if (spec) {
          if (spec.status !== 'running') spec.status = 'running';
          if (ev.type === 'tool_call') spec.toolCalls++;
          if (ev.action === 'record_finding') spec.findingsCount++;
          if (ev.type === 'tool_start' && ev.action) spec.currentActivity = ev.action;
        }

        const acc = getSpecAccum(sid);

        // Finding sub-progress
        if (ev.type === 'finding_progress' && ev.details) {
          const d = ev.details as Record<string, unknown>;
          findingProgress = {
            findingIndex: (d.findingIndex as number) ?? 0,
            findingTotal: (d.findingTotal as number) ?? 0,
            findingId: (d.findingId as string) ?? '',
            phase: (d.phase as FindingProgressState['phase']) ?? 'verifying_evidence',
            evidenceIndex: d.evidenceIndex as number | undefined,
            evidenceTotal: d.evidenceTotal as number | undefined,
            evidenceStatus: d.evidenceStatus as string | undefined,
            evidenceFile: d.evidenceFile as string | undefined,
          };
          continue;
        }

        // Findings (shared pool)
        if (ev.type === 'finding' || ev.action === 'record_finding') {
          parseFinding(ev, findings);
          const existing = acc.currentActivities.find(a => a.label === 'record_finding');
          if (existing) existing.pending = false;
          findingProgress = null;
          continue;
        }

        // Text delta
        if (ev.type === 'text_delta' && ev.reasoning) {
          acc.pendingDeltaText = ev.reasoning;
          continue;
        }

        // Clear status
        if (statusMessage && (ev.type === 'text_response' || ev.type === 'tool_call')) {
          statusMessage = '';
        }

        // Text response — specialist turn boundary
        const specReasoning = ev.fullReasoning ?? ev.reasoning;
        if (ev.type === 'text_response' && specReasoning) {
          if (acc.currentReasoning) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: 'analyze' });
          }
          acc.currentReasoning = specReasoning;
          acc.currentActivities = [];
          acc.pendingDeltaText = '';
          continue;
        }

        // Tool start
        if (ev.type === 'tool_start' && ev.action) {
          if (acc.pendingDeltaText || acc.currentReasoning) {
            const text = acc.pendingDeltaText || acc.currentReasoning;
            if (text && acc.currentActivities.length === 0) {
              acc.currentReasoning = text;
              acc.pendingDeltaText = '';
            }
          }
          const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
          let files: string[] = [];
          let detail = '';
          try {
            const args = ev.args ? JSON.parse(ev.args) : {};
            if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
            if (args.paths) files = args.paths;
            if (args.filePath) files = [args.filePath];
            if (args.pattern) detail = args.pattern;
          } catch { /* parse error */ }
          files = files.filter(f => f && f !== '.');
          const existing = acc.currentActivities.find(a => a.label === ev.action);
          if (existing) { existing.files.push(...files); }
          else { acc.currentActivities.push({ label: ev.action, files, detail, pending: true }); }
          files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));
          const hints = ACTION_CATEGORY_HINTS[ev.action];
          if (hints) hints.forEach(c => coveredTopics.add(c));
          continue;
        }

        // Tool call
        if (ev.type === 'tool_call' && ev.action) {
          const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
          let files: string[] = [];
          let detail = '';
          try {
            const args = ev.args ? JSON.parse(ev.args) : {};
            if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
            if (args.paths) files = args.paths;
            if (args.filePath) files = [args.filePath];
            if (args.pattern) detail = args.pattern;
            if (args.packages) detail = Object.keys(args.packages).join(', ');
          } catch { /* parse error */ }
          files = files.filter(f => f && f !== '.');
          const existing = acc.currentActivities.find(a => a.label === ev.action);
          if (existing) { existing.files.push(...files); existing.pending = false; }
          else { acc.currentActivities.push({ label: ev.action, files, detail }); }
          files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));
          const hints = ACTION_CATEGORY_HINTS[ev.action];
          if (hints) hints.forEach(c => coveredTopics.add(c));
        }

        continue; // All specialist events handled above
      }

      // Clear status once real investigation events arrive
      if (statusMessage && (ev.type === 'text_response' || ev.type === 'tool_call')) {
        statusMessage = '';
      }

      // Model switch (may arrive as both tool_call and model_switch — dedupe)
      if (ev.action === 'switch_to_fast_model' || ev.type === 'model_switch') {
        if (!switchSeen) {
          if (currentReasoning) {
            turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase, workerId: currentWorkerId });
          }
          turns.push({ reasoning: '', activities: [], phase: 'analyze', isSwitch: true, workerId: ev.workerId });
          currentReasoning = '';
          currentActivities = [];
          currentWorkerId = undefined;
          currentPhase = 'write';
          switchSeen = true;
        }
        continue;
      }

      // Finding sub-progress (fires during record_finding execution)
      if (ev.type === 'finding_progress' && ev.details) {
        const d = ev.details as Record<string, unknown>;
        findingProgress = {
          findingIndex: (d.findingIndex as number) ?? 0,
          findingTotal: (d.findingTotal as number) ?? 0,
          findingId: (d.findingId as string) ?? '',
          phase: (d.phase as FindingProgressState['phase']) ?? 'verifying_evidence',
          evidenceIndex: d.evidenceIndex as number | undefined,
          evidenceTotal: d.evidenceTotal as number | undefined,
          evidenceStatus: d.evidenceStatus as string | undefined,
          evidenceFile: d.evidenceFile as string | undefined,
        };
        continue;
      }

      // Findings
      if (ev.type === 'finding' || ev.action === 'record_finding') {
        parseFinding(ev, findings);
        const existing = currentActivities.find(a => a.label === 'record_finding');
        if (existing) existing.pending = false;
        findingProgress = null;
        continue;
      }

      // Assemble output
      if (ev.type === 'assemble_output' || ev.action === 'assemble_output') {
        assembleOutputSeen = true;
      }

      // Post-loop progress (verification, dedup, scorecard, writing output)
      if (ev.type === 'verification' && ev.result) {
        // Commit any pending reasoning first
        if (currentReasoning && currentActivities.length > 0) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase, workerId: currentWorkerId });
          currentReasoning = '';
          currentActivities = [];
          currentWorkerId = undefined;
        }
        turns.push({
          reasoning: String(ev.result),
          activities: [{ label: ev.action ?? 'post_process', files: [], detail: '' }],
          phase: 'write',
          workerId: ev.workerId,
        });
        continue;
      }

      // Streaming text delta — update live typing text as LLM generates
      if (ev.type === 'text_delta' && ev.reasoning) {
        if (!switchSeen) {
          pendingDeltaText = ev.reasoning;
          pendingDeltaWorkerId = ev.workerId;
        }
        continue;
      }

      // New reasoning = new turn boundary (fires on message_end, finalizes the turn)
      // Prefer fullReasoning (verbose mode) over reasoning (truncated to 100 chars)
      const reasoning = ev.fullReasoning ?? ev.reasoning;
      if (ev.type === 'text_response' && reasoning) {
        if (switchSeen) continue;
        if (currentReasoning) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase, workerId: currentWorkerId });
        }
        currentReasoning = reasoning;
        currentWorkerId = ev.workerId;
        currentActivities = [];
        pendingDeltaText = ''; // clear — text_response supersedes deltas
        pendingDeltaWorkerId = undefined;
        continue;
      }

      // Tool start — show activity chip immediately before execution completes
      if (ev.type === 'tool_start' && ev.action) {
        // Commit any pending reasoning as a turn so chips appear under it
        if (pendingDeltaText || currentReasoning) {
          const text = pendingDeltaText || currentReasoning;
          if (text && currentActivities.length === 0) {
            // First tool_start after reasoning — start accumulating under this reasoning
            currentReasoning = text;
            currentWorkerId = currentWorkerId ?? ev.workerId;
            pendingDeltaText = '';
            pendingDeltaWorkerId = undefined;
          }
        }
        const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
        let files: string[] = [];
        let detail = '';
        try {
          const args = ev.args ? JSON.parse(ev.args) : {};
          if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
          if (args.paths) files = args.paths;
          if (args.filePath) files = [args.filePath];
          if (args.pattern) detail = args.pattern;
        } catch { /* parse error */ }
        files = files.filter(f => f && f !== '.');

        const existing = currentActivities.find(a => a.label === ev.action);
        if (existing) {
          existing.files.push(...files);
        } else {
          currentActivities.push({ label: ev.action, files, detail, pending: true });
        }

        files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));

        const hints = ACTION_CATEGORY_HINTS[ev.action];
        if (hints) hints.forEach(c => coveredTopics.add(c));
        continue;
      }

      // Tool call complete — accumulate under current reasoning
      if (ev.type === 'tool_call' && ev.action) {
        const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
        let files: string[] = [];
        let detail = '';
        try {
          const args = ev.args ? JSON.parse(ev.args) : {};
          if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
          if (args.paths) files = args.paths;
          if (args.filePath) files = [args.filePath];
          if (args.pattern) detail = args.pattern;
          if (args.packages) detail = Object.keys(args.packages).join(', ');
        } catch { /* parse error */ }
        files = files.filter(f => f && f !== '.');

        const existing = currentActivities.find(a => a.label === ev.action);
        if (existing) {
          existing.files.push(...files);
          existing.pending = false; // tool_call completes what tool_start started
        } else {
          currentActivities.push({ label: ev.action, files, detail });
        }

        // Track examined files
        files.filter(f => f && f !== '.').forEach(f => examinedFilesSet.add(f));

        // Track topic coverage
        const hints = ACTION_CATEGORY_HINTS[ev.action];
        if (hints) hints.forEach(c => coveredTopics.add(c));
      }
    }

    // ── Resolve final state ──
    // In parallel mode, merge per-worker accumulators into the output and
    // select only the effective worker's state for turns/typing/pending.
    const effectiveWorker = selectedWorkerOverride ?? selectedWorkerId;

    let filteredTurns: StreamTurn[];
    let filteredTypingText: string;
    let filteredPendingActions: string[];
    let filteredFindingProgress: FindingProgressState | null = findingProgress;

    if (isParallel && effectiveWorker) {
      // Resolve the selected worker's accumulator
      const acc = workerAccum.get(effectiveWorker);
      if (acc) {
        // Finalize: commit remaining reasoning or surface as typing text
        let wTyping = '';
        if (acc.currentReasoning) {
          if (acc.currentActivities.length > 0) {
            acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: acc.currentPhase, workerId: effectiveWorker });
          } else {
            wTyping = acc.currentReasoning;
          }
        }
        if (acc.pendingDeltaText) wTyping = acc.pendingDeltaText;

        // Include shared (non-worker) turns first, then this worker's turns
        const sharedTurns = turns.filter(t => !t.workerId);
        filteredTurns = [...sharedTurns, ...acc.turns];
        filteredTypingText = cleanReasoning(wTyping);
        filteredPendingActions = acc.currentActivities.filter(a => a.pending).map(a => a.label);
        // Only show finding progress if this worker is running
        if (findingProgress) {
          const w = workers?.get(effectiveWorker);
          if (w && w.status !== 'running') filteredFindingProgress = null;
        }
      } else {
        // Worker not started yet — show shared turns only
        filteredTurns = turns.filter(t => !t.workerId);
        filteredTypingText = '';
        filteredPendingActions = [];
      }

      // Clean reasoning in filtered turns
      for (const turn of filteredTurns) {
        turn.reasoning = cleanReasoning(turn.reasoning);
      }
    } else {
      // Non-parallel: use the single-track accumulators (original behavior)
      let typingText = '';
      if (currentReasoning) {
        if (currentActivities.length > 0) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase, workerId: currentWorkerId });
        } else {
          typingText = currentReasoning;
        }
      }
      if (pendingDeltaText) typingText = pendingDeltaText;

      for (const turn of turns) {
        turn.reasoning = cleanReasoning(turn.reasoning);
      }
      typingText = cleanReasoning(typingText);

      // Specialist view switching: when a specialist is selected, show its turns
      const effectiveSpecialist = selectedSpecialistOverride !== undefined ? selectedSpecialistOverride : selectedSpecialistId;
      if (effectiveSpecialist && specialists) {
        const acc = specialistAccum.get(effectiveSpecialist);
        if (acc) {
          let sTyping = '';
          if (acc.currentReasoning) {
            if (acc.currentActivities.length > 0) {
              acc.turns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: 'analyze' });
              acc.currentReasoning = '';
              acc.currentActivities = [];
            } else {
              sTyping = acc.currentReasoning;
            }
          }
          if (acc.pendingDeltaText) sTyping = acc.pendingDeltaText;
          for (const turn of acc.turns) {
            turn.reasoning = cleanReasoning(turn.reasoning);
          }
          filteredTurns = acc.turns;
          filteredTypingText = cleanReasoning(sTyping);
          filteredPendingActions = acc.currentActivities.filter(a => a.pending).map(a => a.label);
        } else {
          filteredTurns = [];
          filteredTypingText = '';
          filteredPendingActions = [];
        }
      } else {
        filteredTurns = turns;
        filteredTypingText = typingText;
        filteredPendingActions = currentActivities.filter(a => a.pending).map(a => a.label);
      }
    }

    // Derive phase
    let phase: AnimationPhase;
    if (runStatus === 'complete' || runStatus === 'error') {
      phase = 'done';
    } else if (assembleOutputSeen) {
      phase = 'assembling';
    } else if (switchSeen) {
      phase = findings.length > 0 ? 'recording' : 'switching';
    } else {
      phase = 'analyzing';
    }

    // Progress: tool calls / budget ratio
    let progressPercent = 0;
    if (runStatus === 'complete' || runStatus === 'error') {
      progressPercent = 100;
    } else if (budget > 0) {
      progressPercent = Math.min(95, Math.round((toolCalls / budget) * 100));
    }

    // Last committed turn is "active" while waiting for next reasoning
    const activeTurnIndex = filteredTypingText === '' && filteredTurns.length > 0 && phase !== 'done'
      ? filteredTurns.length - 1
      : null;

    const scoreVisible = phase === 'done' && findings.length > 0;

    // Build specialistTurns map from accumulators
    const specialistTurnsMap = new Map<string, StreamTurn[]>();
    for (const [sid, acc] of specialistAccum) {
      const sTurns = [...acc.turns];
      if (acc.currentReasoning) {
        sTurns.push({ reasoning: acc.currentReasoning, activities: [...acc.currentActivities], phase: 'analyze' });
      }
      for (const t of sTurns) { t.reasoning = cleanReasoning(t.reasoning); }
      specialistTurnsMap.set(sid, sTurns);
    }

    return {
      phase,
      turns: filteredTurns,
      typingText: filteredTypingText,
      activeTurnIndex,
      coveredTopics,
      examinedFiles: [...examinedFilesSet],
      findings,
      scoreVisible,
      progressPercent,
      pendingActions: filteredPendingActions,
      statusMessage,
      findingProgress: filteredFindingProgress,
      workers,
      selectedWorkerId: effectiveWorker,
      synthesisStatus,
      isParallel,
      specialists,
      selectedSpecialistId: selectedSpecialistOverride !== undefined ? selectedSpecialistOverride : selectedSpecialistId,
      specialistTurns: specialistTurnsMap,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsVersion, runStatus, toolCalls, budget, selectedWorkerOverride, selectedSpecialistOverride]);
}
