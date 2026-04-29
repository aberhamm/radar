'use client';

import { useMemo } from 'react';
import type { StepEvent } from './agentSession';
import type { AnimationPhase } from './useAnimationSequence';
import type { Activity, Finding, StreamTurn } from './runTransform';
import { ACTION_CATEGORY_HINTS, cleanReasoning } from './runTransform';

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
    let statusMessage = '';

    for (const ev of events) {
      // Startup status events (loading agent, starting analysis)
      if (ev.type === 'status' && ev.result) {
        statusMessage = String(ev.result);
        continue;
      }

      // Budget plan (multi-goal: before first pass)
      if (ev.action === 'budget_plan' && ev.result) {
        turns.push({ reasoning: 'Budget plan computed from repo signals', activities: [{ label: 'budget_plan', files: [], detail: ev.result }], phase: 'analyze' });
        statusMessage = 'Budget allocated — starting Core pass...';
        continue;
      }

      // Budget rebalance (multi-goal: after core, before specialists)
      if (ev.action === 'budget_rebalance' && ev.result) {
        turns.push({ reasoning: 'Specialist budgets adjusted based on core findings', activities: [{ label: 'budget_rebalance', files: [], detail: ev.result }], phase: 'analyze' });
        statusMessage = 'Budgets rebalanced — starting specialist passes...';
        continue;
      }

      // Pass boundary (multi-goal: between investigation passes)
      if (ev.action === 'pass_boundary' && ev.result) {
        if (currentReasoning) {
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase });
        }
        turns.push({ reasoning: `Starting ${ev.result} pass`, activities: [], phase: 'analyze' });
        currentReasoning = '';
        currentActivities = [];
        statusMessage = `Running ${ev.result} pass...`;
        continue;
      }

      // Clear status once real investigation events arrive
      if (statusMessage && (ev.type === 'text_response' || ev.type === 'tool_call')) {
        statusMessage = '';
      }

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
          let f = args.finding ?? args;
          if (typeof f === 'string') f = JSON.parse(f);
          if (!f || typeof f !== 'object' || !f.title) continue;
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

          // Dedup: same category + 50%+ evidence file overlap → merge
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
            const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
            const keepSeverity = (SEV_RANK[existing.severity] ?? 0) >= (SEV_RANK[incoming.severity] ?? 0)
              ? existing.severity : incoming.severity;
            const seenEvPaths = new Set(existing.evidenceFiles.map((f, i) => `${f}:${existing.evidence[i]?.lineNumber ?? 'none'}`));
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
        // Clear pending state on any matching activity chip (tool_start fires
        // before the finding event, so the activity exists but stays pending=true
        // because 'finding' type never reaches the tool_call handler below).
        const existing = currentActivities.find(a => a.label === 'record_finding');
        if (existing) existing.pending = false;
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
          turns.push({ reasoning: currentReasoning, activities: [...currentActivities], phase: currentPhase });
          currentReasoning = '';
          currentActivities = [];
        }
        turns.push({
          reasoning: String(ev.result),
          activities: [{ label: ev.action ?? 'post_process', files: [], detail: '' }],
          phase: 'write',
        });
        continue;
      }

      // Streaming text delta — update live typing text as LLM generates
      if (ev.type === 'text_delta' && ev.reasoning) {
        if (!switchSeen) pendingDeltaText = ev.reasoning;
        continue;
      }

      // New reasoning = new turn boundary (fires on message_end, finalizes the turn)
      // Prefer fullReasoning (verbose mode) over reasoning (truncated to 100 chars)
      const reasoning = ev.fullReasoning ?? ev.reasoning;
      if (ev.type === 'text_response' && reasoning) {
        if (switchSeen) continue;
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

    // Clean reasoning in all turns and typing text
    for (const turn of turns) {
      turn.reasoning = cleanReasoning(turn.reasoning);
    }
    typingText = cleanReasoning(typingText);

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
      statusMessage,
    };
  }, [events, runStatus, toolCalls, budget]);
}
