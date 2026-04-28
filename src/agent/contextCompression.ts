/**
 * Context compression for the Pi Agent's conversation history.
 *
 * As the agent investigates, its context window fills with tool results
 * (file contents, grep output, etc.). Without compression, the context
 * overflows or the LLM loses track of earlier findings. This module
 * implements the transformContext callback that Pi calls before each
 * LLM turn, selectively compressing old messages while preserving
 * critical evidence.
 *
 * Three strategies, applied in priority order:
 *
 *   1. EVIDENCE PINNING — Tool results whose files appear in recorded
 *      findings are never compressed. The writing phase needs raw evidence
 *      to produce accurate briefs.
 *
 *   2. STALE-READ COLLAPSING — When the same file is read multiple times
 *      (e.g. to check different sections), only the most recent read keeps
 *      its full content. Earlier reads become one-line stubs.
 *
 *   3. OBSERVATION EVICTION — Everything else outside the "recent window"
 *      (last N messages) becomes a one-liner: "[tool_name: first line... (N chars)]".
 *
 * Writing tool results (record_finding, assemble_output) are never compressed.
 * The recent window shrinks from 12 to 8 messages after model switch
 * (snipBoundaryActive) to free context for the cheaper writing model.
 *
 * Exposed as a factory function so the runner can pass shared mutable state
 * (findings array, snipBoundaryActive flag) by reference.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Finding } from '../types/findings.js';
import { KEEP_RECENT_NORMAL, KEEP_RECENT_SNIP } from '../config/defaults.js';
/** Tools whose results must never be compressed (they ARE the output). */
const WRITING_TOOL_NAMES = new Set(['record_finding', 'assemble_output', 'switch_to_fast_model']);

/** Mutable state shared with the runner via object reference. */
export interface CompressionState {
  findings: Finding[];
  /** When true, uses the tighter KEEP_RECENT_SNIP window. Set by runner on model switch. */
  snipBoundaryActive: boolean;
}

/** Maps maintained by the runner's afterToolCall hook, shared with the compressor. */
export interface ToolCallMaps {
  /** Which file paths each toolCallId touched (for pinning and stale detection). */
  toolCallIdToFiles: Map<string, Set<string>>;
  /** Tool name for each toolCallId (for generating readable stubs). */
  toolCallIdToName: Map<string, string>;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Create the transformContext callback for the Pi Agent.
 *
 * Uses three strategies:
 *   1. Evidence pinning — results whose files appear in recorded findings
 *      are NEVER compressed. The writing phase needs this raw evidence.
 *   2. Stale-read collapsing — when the same file was read multiple times,
 *      only the most recent read stays; earlier reads become one-line stubs.
 *   3. Observation eviction — everything else outside the recent window
 *      becomes a clean one-liner with tool name + size hint.
 *
 * Writing tool results (record_finding, assemble_output) are never compressed.
 * Assistant/user messages pass through unchanged.
 * Stubs are cached by toolCallId to avoid recomputing on each turn.
 */
export function createTransformContext(
  state: CompressionState,
  maps: ToolCallMaps,
): { transformContext: (messages: AgentMessage[]) => Promise<AgentMessage[]>; clearSummaryCache: () => void } {
  const summaryCache = new Map<string, string>();

  let cachedEvidenceFiles: Set<string> | null = null;
  let cachedPinnedToolCallIds: Set<string> | null = null;
  let cachedFindingsCount = -1;

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    const keepRecent = state.snipBoundaryActive ? KEEP_RECENT_SNIP : KEEP_RECENT_NORMAL;
    if (messages.length <= keepRecent) return messages;

    // Rebuild pinned sets only when findings count changes (cache invalidation)
    if (cachedFindingsCount !== state.findings.length) {
      cachedEvidenceFiles = new Set<string>();
      for (const f of state.findings) {
        for (const ev of f.evidence) {
          cachedEvidenceFiles.add(normPath(ev.filePath));
        }
      }

      cachedPinnedToolCallIds = new Set<string>();
      for (const [tcId, files] of maps.toolCallIdToFiles) {
        for (const file of files) {
          if (cachedEvidenceFiles.has(normPath(file))) {
            cachedPinnedToolCallIds.add(tcId);
            break;
          }
        }
      }

      cachedFindingsCount = state.findings.length;
    }

    const evidenceFiles = cachedEvidenceFiles!;
    const pinnedToolCallIds = cachedPinnedToolCallIds!;

    // Build latest-read map: for each file, which toolCallId read it most recently?
    const latestReadByFile = new Map<string, string>();
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || !('role' in msg)) continue;
      const tr = msg as unknown as { role: string; toolCallId?: string };
      if (tr.role !== 'toolResult' || !tr.toolCallId) continue;
      const files = maps.toolCallIdToFiles.get(tr.toolCallId);
      if (files) {
        for (const f of files) latestReadByFile.set(normPath(f), tr.toolCallId);
      }
    }

    // Identify stale reads: tool calls superseded by a later read of the same file
    const staleToolCallIds = new Set<string>();
    for (const [tcId, files] of maps.toolCallIdToFiles) {
      if (pinnedToolCallIds.has(tcId)) continue;
      for (const f of files) {
        const latest = latestReadByFile.get(normPath(f));
        if (latest && latest !== tcId) {
          staleToolCallIds.add(tcId);
          break;
        }
      }
    }

    // Apply compression to messages outside the recent window
    const tier1Start = messages.length - keepRecent;

    return messages.map((msg, i) => {
      // Recent window — always keep intact
      if (i >= tier1Start) return msg;
      if (!msg || typeof msg !== 'object' || !('role' in msg)) return msg;
      if ((msg as { role: string }).role !== 'toolResult') return msg;

      const tr = msg as unknown as { role: string; toolCallId?: string; content: { type: string; text?: string }[]; [k: string]: unknown };
      const tcId = tr.toolCallId;
      const tcName = tcId ? maps.toolCallIdToName.get(tcId) : undefined;

      if (tcName && WRITING_TOOL_NAMES.has(tcName)) return msg;
      if (tcId && pinnedToolCallIds.has(tcId)) return msg;

      if (tcId && staleToolCallIds.has(tcId)) {
        const cacheKey = `${tcId}:stale`;
        if (summaryCache.has(cacheKey)) {
          return { ...tr, content: [{ type: 'text', text: summaryCache.get(cacheKey)! }] } as AgentMessage;
        }
        const stub = '[superseded — file re-read in a later tool call]';
        summaryCache.set(cacheKey, stub);
        return { ...tr, content: [{ type: 'text', text: stub }] } as AgentMessage;
      }

      return {
        ...tr,
        content: tr.content.map((c) => {
          if (c.type !== 'text' || !c.text || c.text.length <= 150) return c;
          const cacheKey = tcId ? `${tcId}:evict` : undefined;
          if (cacheKey && summaryCache.has(cacheKey)) {
            return { ...c, text: summaryCache.get(cacheKey)! };
          }
          const name = tcName ?? 'tool';
          const firstLine = c.text.slice(0, 100).split('\n')[0];
          const stub = `[${name}: ${firstLine}... (${c.text.length} chars)]`;
          if (cacheKey) summaryCache.set(cacheKey, stub);
          return { ...c, text: stub };
        }),
      } as AgentMessage;
    });
  };

  return {
    transformContext,
    clearSummaryCache: () => summaryCache.clear(),
  };
}

/**
 * Create the onPayload callback for prompt caching.
 *
 * Injects Anthropic cache_control breakpoints into the system prompt so the
 * static prefix (system instructions + tool definitions) is cached across
 * turns. Portkey forwards these annotations to Bedrock's Anthropic API.
 * This reduces input token costs significantly on multi-turn conversations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOnPayload(): (payload: any) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (payload: any) => {
    if (!payload || typeof payload !== 'object') return undefined;
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      if (typeof payload.system === 'string') {
        payload.system = [{ type: 'text', text: payload.system, cache_control: { type: 'ephemeral' } }];
      } else if (Array.isArray(payload.system) && payload.system.length > 0) {
        const last = payload.system[payload.system.length - 1];
        if (last && typeof last === 'object') {
          last.cache_control = { type: 'ephemeral' };
        }
      }
    }
    return payload;
  };
}
