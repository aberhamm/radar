'use client';

import { useMemo } from 'react';
import type { StepEvent } from './agentSession';
import type { AnimationPhase } from './useAnimationSequence';
import type { Activity, Finding, StreamTurn } from './runTransform';
import { ACTION_CATEGORY_HINTS } from './runTransform';

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
}

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
  runStatus: string,
  toolCalls: number,
  budget: number,
): LiveAnalysisState {
  return useMemo(() => {
    const turns: StreamTurn[] = [];
    let currentReasoning = '';
    let currentActivities: Activity[] = [];
    let currentPhase: 'analyze' | 'write' = 'analyze';
    const coveredTopics = new Set<string>();
    const examinedFilesSet = new Set<string>();
    const findings: Finding[] = [];
    let switchSeen = false;
    let assembleOutputSeen = false;
    let pendingDeltaText = ''; // accumulates text_delta content for live typing

    for (const ev of events) {
      // Model switch (may arrive as both tool_call and model_switch — dedupe)
      if (ev.action === 'switch_to_fast_model' || ev.type === 'model_switch') {
        if (!switchSeen) {
          if (currentReasoning) {
            turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase });
          }
          turns.push({ reasoning: '', activities: [], phase: 'analyze', isSwitch: true });
          currentReasoning = '';
          currentActivities = [];
          currentPhase = 'write';
          switchSeen = true;
        }
        continue;
      }

      // Findings
      if (ev.type === 'finding' || ev.action === 'record_finding') {
        try {
          const args = ev.args ? JSON.parse(ev.args) : {};
          const f = args.finding ?? args;
          findings.push({
            id: f.id ?? `f-${findings.length}`,
            severity: f.severity ?? 'info',
            category: f.category ?? '',
            title: f.title ?? ev.action,
            evidenceFiles: (f.evidence ?? []).map((e: { filePath: string }) => e.filePath),
            note: f.investigationNote ?? f.description ?? '',
            tags: f.tags ?? [],
          });
        } catch { /* parse error */ }
        continue;
      }

      // Assemble output
      if (ev.type === 'assemble_output' || ev.action === 'assemble_output') {
        assembleOutputSeen = true;
      }

      // Streaming text delta — update live typing text as LLM generates
      if (ev.type === 'text_delta' && ev.reasoning) {
        pendingDeltaText = ev.reasoning;
        continue;
      }

      // New reasoning = new turn boundary (fires on message_end, finalizes the turn)
      // Prefer fullReasoning (verbose mode) over reasoning (truncated to 100 chars)
      const reasoning = ev.fullReasoning ?? ev.reasoning;
      if (ev.type === 'text_response' && reasoning) {
        if (currentReasoning) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase });
        }
        currentReasoning = reasoning;
        currentActivities = [];
        pendingDeltaText = ''; // clear — text_response supersedes deltas
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
            pendingDeltaText = '';
          }
        }
        let files: string[] = [];
        let detail = '';
        try {
          const args = ev.args ? JSON.parse(ev.args) : {};
          if (args.path) files = [args.path];
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
        let files: string[] = [];
        let detail = '';
        try {
          const args = ev.args ? JSON.parse(ev.args) : {};
          if (args.path) files = [args.path];
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

    // Remaining events: commit as turn or show as typing
    let typingText = '';
    if (currentReasoning) {
      if (currentActivities.length > 0) {
        turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase });
      } else {
        typingText = currentReasoning;
      }
    }
    // Streaming text (text_delta) takes priority — shows live LLM output
    if (pendingDeltaText) {
      typingText = pendingDeltaText;
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
    const activeTurnIndex = typingText === '' && turns.length > 0 && phase !== 'done'
      ? turns.length - 1
      : null;

    const scoreVisible = phase === 'done' && findings.length > 0;

    // Collect currently-executing tool names (pending = tool_start without tool_call yet)
    const pendingActions = currentActivities
      .filter(a => a.pending)
      .map(a => a.label);

    return {
      phase,
      turns,
      typingText,
      activeTurnIndex,
      coveredTopics,
      examinedFiles: [...examinedFilesSet],
      findings,
      scoreVisible,
      progressPercent,
      pendingActions,
    };
  }, [events, runStatus, toolCalls, budget]);
}
