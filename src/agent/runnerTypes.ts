/**
 * Public type contracts for the runner subsystem.
 *
 * Every consumer of runAgent() — CLI commands, the dashboard, tests — imports
 * these interfaces. They live in their own file so that type-only dependents
 * (like budgetPlanner) don't pull in the full runner module and its heavy
 * runtime dependencies.
 */

import type { Model } from '@mariozechner/pi-ai';
import type { AgentState, GoalType } from '../types/state.js';
import type { Scorecard, RunMetrics } from '../types/output.js';
import type { PreComputeResult } from './preCompute.js';

/** Per-token pricing for a single model, used to estimate run cost. */
export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cachedInputPerToken: number;
}

/** Full pricing config loaded from model-pricing.json at startup. */
export interface PricingConfig {
  models: Record<string, ModelPricing & { displayName: string }>;
  defaultPricing: ModelPricing;
}

/** Configuration for a single runAgent() invocation. */
export interface RunnerConfig {
  repoPath: string;
  repoName: string;
  repoSource: 'github' | 'local';
  repoUrl?: string;
  goal: GoalType;
  platform?: string;
  /** Scope investigation to a specific app root within a monorepo (relative path from repoPath) */
  appRoot?: string;
  toolCallBudget?: number;
  webSearchBudget?: number;
  urlFetchBudget?: number;
  docTokenBudget?: number;
  outputDir?: string;
  /** Callback for each step — enables live CLI output */
  onStep?: (step: StepEvent) => void;
  /** Enable verbose output with full reasoning and arguments */
  verbose?: boolean;
  /**
   * Called when tool call budget is exhausted. Return true to extend
   * by 50 more calls, false to stop and assemble with current findings.
   * If not provided, auto-assembles (CI-safe default).
   */
  onBudgetExhausted?: (state: { findings: number; toolCalls: number; budget: number }) => Promise<boolean>;
  /** Override Pi model (e.g. faux provider for testing). If omitted, builds from env vars. */
  model?: Model<any>;
  /** Override Pi fast model (e.g. faux provider for testing). If omitted, builds from env vars. */
  fastModel?: Model<any>;
  /** Path to checkpoint JSONL file to resume from. */
  resumeFrom?: string;
  /** Save checkpoints every N tool calls (default: 5). Set 0 to disable. */
  checkpointInterval?: number;
  /** Pre-populated state from a prior pass (for tiered investigation).
   *  Findings, filesRead, fileReadCache carry over. Budgets reset. */
  initialState?: Partial<AgentState>;
  /** Pre-computed repo signals (app roots, package.json, file tree).
   *  When provided, runAgent skips its own runPreCompute() call. */
  preCompute?: PreComputeResult;
}

/**
 * Real-time progress event emitted via onStep() during the agent loop.
 * The CLI renders these as live step output; the dashboard streams them via SSE.
 */
export interface StepEvent {
  step: number;
  action: string;
  reasoning?: string;
  result?: string;
  /** Full reasoning text (untruncated) */
  fullReasoning?: string;
  /** Full result text (capped at ~10 KB) */
  fullResult?: string;
  /** Tool call arguments as JSON string */
  args?: string;
  /** Type of event: tool_call, finding, budget_warning, text_response, assemble_output, model_switch */
  type?: 'tool_call' | 'tool_start' | 'finding' | 'budget_warning' | 'text_response' | 'text_delta' | 'assemble_output' | 'model_switch' | 'verification';
  /** Identifies which tool calls ran in the same parallel batch (same assistant turn) */
  batchId?: string;
  /** New budget after extension (only on budget_extended events) */
  newBudget?: number;
  /** ISO timestamp when this event was emitted */
  timestamp?: string;
  /** Structured metadata from the tool result (e.g. findingId, severity, matchCount) */
  details?: Record<string, unknown>;
  /** Accumulated thinking/reasoning block content from the assistant turn */
  thinking?: string;
  /** Model ID that generated this turn */
  model?: string;
  /** Duration of tool execution in milliseconds */
  durationMs?: number;
}

/** Everything produced by a single runAgent() call — scorecard, brief, metrics, and raw state. */
export interface RunResult {
  scorecard: Scorecard;
  briefMarkdown: string;
  exportJson: string;
  outputPaths: string[];
  metrics: RunMetrics;
  state: AgentState;
  /** How the run ended: completed (assemble_output called), budget_exhausted, stuck, or error */
  terminationReason: 'completed' | 'budget_exhausted' | 'stuck' | 'error';
  /** Error message if terminationReason is 'error' */
  errorDetail?: string;
  /** Evidence source files captured for the dashboard file viewer */
  sources?: Record<string, { content: string; lineCount: number; language: string }>;
}
