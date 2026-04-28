/**
 * Tunable application defaults — the single place to adjust knobs that
 * affect budget, context compression, and agent behavior thresholds.
 *
 * Only values referenced from more than one module or that an operator
 * might want to tune live here. Implementation-detail constants (tool
 * name sets, category enums, retry-per-status maps) stay in their
 * owning module.
 */

// ─── Budget defaults ────────────────────────────────────────────────

export const TOOL_CALL_BUDGET = 45;
export const TOOL_CALL_BUDGET_MULTI = 15;
export const BUDGET_EXTENSION = 50;
export const WEB_SEARCH_BUDGET = 5;
export const URL_FETCH_BUDGET = 3;
export const DOC_TOKEN_BUDGET = 20_000;
export const CHECKPOINT_INTERVAL = 5;

// ─── Agent behavior thresholds ──────────────────────────────────────

export const RECORDING_GATE_PCT = 0.60;
export const KEEP_RECENT_NORMAL = 12;
export const KEEP_RECENT_SNIP = 8;
export const MIN_SPECIALIST_BUDGET = 10;
