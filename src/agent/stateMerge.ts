/**
 * State merging for multi-pass (tiered) investigation and checkpoint resume.
 *
 * When the runner executes multiple passes (e.g. core → nextjs → a11y),
 * each pass starts with a fresh AgentState but carries over accumulated
 * knowledge (findings, file caches, version info) from prior passes.
 * Checkpoint resume uses the same merge to rehydrate after an interruption.
 *
 * Intentionally does NOT carry over: toolCallCount, toolCallBudget,
 * webSearchCount, urlFetchCount, goal, investigationLog — these reset
 * per-pass so each specialist gets its own budget and clean log.
 */

import type { AgentState } from '../types/state.js';

/**
 * Merge carry-over fields from source into target.
 * Carries over: findings, filesRead, fileReadCache, resolvedVersions, stackProfile, fetchedDocs, modelUsage.
 * Does NOT carry over: toolCallCount, toolCallBudget, webSearchCount, urlFetchCount, goal, investigationLog.
 * Includes input validation — rejects corrupt state shapes gracefully.
 */
export function mergeState(target: AgentState, source: Partial<AgentState>): void {
  if (source.findings && Array.isArray(source.findings)) {
    target.findings = [...source.findings];
  }
  if (source.filesRead && source.filesRead instanceof Set) {
    for (const f of source.filesRead) target.filesRead.add(f);
  }
  if (source.fileReadCache && source.fileReadCache instanceof Map) {
    for (const [k, v] of source.fileReadCache) {
      target.fileReadCache.set(k, v);
    }
  }
  if (source.resolvedVersions && typeof source.resolvedVersions === 'object') {
    target.resolvedVersions = { ...source.resolvedVersions };
  }
  if (source.stackProfile) {
    target.stackProfile = source.stackProfile;
  }
  if (source.fetchedDocs && Array.isArray(source.fetchedDocs)) {
    target.fetchedDocs = [...source.fetchedDocs];
  }
  if (source.modelUsage && source.modelUsage instanceof Map) {
    for (const [k, v] of source.modelUsage) {
      const existing = target.modelUsage.get(k);
      if (existing) {
        existing.calls += v.calls;
        existing.inputTokens += v.inputTokens;
        existing.outputTokens += v.outputTokens;
        existing.cachedTokens += v.cachedTokens;
      } else {
        target.modelUsage.set(k, { ...v });
      }
    }
  }
}
