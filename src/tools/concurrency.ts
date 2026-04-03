/**
 * Tool concurrency partitioning.
 *
 * Pi Agent's `toolExecution: 'parallel'` fires all tool calls from a single
 * assistant turn concurrently. This is great for read-only tools (read_file,
 * grep_pattern, find_files) but unsafe for stateful tools (record_finding,
 * assemble_output) that mutate shared AgentState.
 *
 * Solution: wrap stateful tool execute() functions with an async mutex so they
 * self-serialize even when Pi fires them concurrently. Read-only tools remain
 * fully parallel.
 */

/**
 * Tools that only read data. Their execute() functions do not perform any
 * writes that require mutex protection.
 *
 * Exception: read_file and read_files_batch do mutate state.filesRead, but
 * that's intentional — recordFinding checks filesRead inside its own execute()
 * and would race with afterToolCall, so the add must happen in execute().
 * webSearchCount and urlFetchCount are tracked in afterToolCall in runner.ts
 * since they're only checked in beforeToolCall (no execute()-level race).
 */
const READ_ONLY_TOOLS = new Set([
  'list_directory',
  'read_file',
  'read_files_batch',
  'grep_pattern',
  'find_files',
  'parse_package_json',
  'parse_next_config',
  'parse_tsconfig',
  'parse_env_file',
  'check_gitignore',
  'query_npm_versions',
  'compare_versions',
  'analyze_route_structure',
  'analyze_component_directives',
  'analyze_env_usage',
  'analyze_middleware',
  'detect_app_roots',
  'web_search',
  'fetch_url',
  'tool_search',
]);

/** Tools that mutate shared state and must not run concurrently. */
const STATEFUL_TOOLS = new Set([
  'record_finding',
  'assemble_output',
  'switch_to_fast_model',
]);

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isStateful(toolName: string): boolean {
  return STATEFUL_TOOLS.has(toolName);
}

/**
 * Async mutex that serializes stateful tool execution.
 *
 * Each call to `serialize(fn)` waits for the previous one to finish
 * before starting. Read-only tools bypass this entirely.
 */
export class StatefulToolMutex {
  private _chain: Promise<void> = Promise.resolve();

  /**
   * Run `fn` after all previously queued operations complete.
   * Returns fn's result. Errors propagate to the caller but
   * don't break the chain for subsequent calls.
   */
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._chain.then(fn, fn);
    // Keep the chain going regardless of success/failure
    this._chain = result.then(() => {}, () => {});
    return result;
  }
}
