/**
 * LLM usage tracking and cost estimation.
 *
 * Accumulates per-model token counts (input, output, cached) during the agent
 * loop, then computes estimated USD cost using pricing from model-pricing.json.
 *
 * The pricing config is loaded once at module init (eagerly, synchronous).
 * If the file is missing or malformed, falls back to conservative defaults.
 * Cache token discounts are applied: cached input tokens cost less than fresh
 * input tokens, so the discount is (inputRate - cachedRate) * cachedTokens.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentState } from '../types/state.js';
import type { RunMetrics } from '../types/output.js';
import type { PricingConfig } from './runnerTypes.js';

// Load pricing at module init — synchronous, one-time cost
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingPath = path.resolve(__dirname, '../config/model-pricing.json');
let pricingConfig: PricingConfig;
try {
  pricingConfig = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));
} catch {
  pricingConfig = {
    models: {},
    defaultPricing: { inputPerToken: 0.000003, outputPerToken: 0.000015, cachedInputPerToken: 0.0000003 },
  };
}

/** Accumulate one LLM call's token usage into state.modelUsage. Called after each assistant message. */
export function trackUsage(
  state: AgentState,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number },
): void {
  const existing = state.modelUsage.get(model) ?? {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
  };
  state.modelUsage.set(model, {
    calls: existing.calls + 1,
    inputTokens: existing.inputTokens + usage.inputTokens,
    outputTokens: existing.outputTokens + usage.outputTokens,
    cachedTokens: existing.cachedTokens + usage.cachedTokens,
  });
}

/** Build the final RunMetrics object from accumulated usage data and timing info. */
export function buildMetrics(
  state: AgentState,
  startedAt: Date,
  completedAt: Date,
  llmLatencyMs?: number,
  llmTurns?: number,
): RunMetrics {
  const models: RunMetrics['models'] = {};
  for (const [modelId, usage] of state.modelUsage.entries()) {
    const pricing = pricingConfig.models[modelId] ?? pricingConfig.defaultPricing;
    const inputCost = usage.inputTokens * pricing.inputPerToken;
    const outputCost = usage.outputTokens * pricing.outputPerToken;
    const cachedDiscount = usage.cachedTokens * (pricing.inputPerToken - pricing.cachedInputPerToken);
    const estimated = inputCost + outputCost - cachedDiscount;

    models[modelId] = {
      bedrockModelId: modelId,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      estimatedCostUsd: Math.round(estimated * 10000) / 10000,
    };
  }

  const totalCost = Object.values(models).reduce(
    (sum, m) => sum + m.estimatedCostUsd,
    0,
  );

  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    toolCalls: state.totalToolCallsExecuted,
    models,
    totalEstimatedCostUsd: Math.round(totalCost * 10000) / 10000,
    ...(llmLatencyMs != null ? { llmLatencyMs } : {}),
    ...(llmTurns != null ? { llmTurns } : {}),
  };
}
