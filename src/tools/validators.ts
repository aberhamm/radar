/**
 * Input validators for all tools.
 *
 * Each validator checks semantic constraints that TypeBox schemas can't express
 * (e.g., "URL must be http/https", "maxResults must be 1-500"). They run before
 * execute() so bad LLM arguments are rejected before any I/O.
 *
 * Returns null on success, or a descriptive error string on failure.
 */

export type ToolValidator = (params: Record<string, unknown>) => string | null;

const FINDING_CATEGORIES = new Set([
  'stack', 'cms-integration', 'preview-editing', 'configuration', 'security',
  'architecture', 'dependencies', 'deployment', 'routing', 'data-fetching', 'nextjs',
  'performance', 'accessibility', 'forms', 'aria',
  'auth', 'secrets', 'input-validation', 'data-exposure', 'testing', 'dx',
  'media-alt', 'semantic-html', 'keyboard-focus', 'color-contrast',
]);

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

function requireString(params: Record<string, unknown>, field: string): string | null {
  const val = params[field];
  if (val === undefined || val === null || typeof val !== 'string' || val.trim() === '') {
    return `${field} is required and must be a non-empty string`;
  }
  return null;
}

function requireArray(params: Record<string, unknown>, field: string, maxItems?: number): string | null {
  const val = params[field];
  if (!Array.isArray(val) || val.length === 0) {
    return `${field} is required and must be a non-empty array`;
  }
  if (maxItems !== undefined && val.length > maxItems) {
    return `${field} exceeds maximum of ${maxItems} items (got ${val.length})`;
  }
  return null;
}

function numberInRange(params: Record<string, unknown>, field: string, min: number, max: number): string | null {
  const val = params[field];
  if (val === undefined || val === null) return null; // optional
  if (typeof val !== 'number' || val < min || val > max) {
    return `${field} must be a number between ${min} and ${max}`;
  }
  return null;
}

export const VALIDATORS: Record<string, ToolValidator> = {
  // --- Repo tools ---
  list_directory: (p) => {
    return requireString(p, 'path');
  },

  read_file: (p) => {
    return requireString(p, 'path')
      ?? numberInRange(p, 'maxLines', 1, 10_000)
      ?? numberInRange(p, 'startLine', 1, 1_000_000);
  },

  read_files_batch: (p) => {
    // Accept stringified JSON arrays (normalizePathArgs will coerce them)
    if (typeof p.paths === 'string') {
      try {
        const parsed = JSON.parse(p.paths);
        if (!Array.isArray(parsed)) return 'paths must be an array or JSON-stringified array';
      } catch {
        return 'paths must be an array or valid JSON-stringified array';
      }
    } else {
      const err = requireArray(p, 'paths', 20);
      if (err) return err;
    }
    return numberInRange(p, 'maxLinesPerFile', 1, 10_000);
  },

  // --- Search tools ---
  grep_pattern: (p) => {
    return requireString(p, 'pattern')
      ?? numberInRange(p, 'maxResults', 1, 500)
      ?? numberInRange(p, 'offset', 0, 10_000);
  },

  find_files: (p) => {
    return requireString(p, 'pattern');
  },

  // --- Config tools ---
  parse_package_json: () => null, // path is optional (defaults to root)

  parse_next_config: () => null,

  parse_tsconfig: () => null,

  parse_env_file: (p) => {
    return requireString(p, 'path');
  },

  check_gitignore: (p) => {
    return requireArray(p, 'patterns');
  },

  // --- Dependency tools ---
  query_npm_versions: (p) => {
    return requireArray(p, 'packages', 50);
  },

  compare_versions: (p) => {
    return requireArray(p, 'installed')
      ?? (typeof p.latest !== 'object' || p.latest === null ? 'latest is required and must be an object' : null);
  },

  // --- Analysis tools ---
  analyze_route_structure: () => null,

  analyze_component_directives: (p) => {
    return requireString(p, 'path');
  },

  analyze_env_usage: () => null,

  analyze_middleware: () => null,

  detect_app_roots: () => null,

  detect_scope_drift: () => null,

  get_specialist_prompts: (p) => {
    if (!Array.isArray(p.roots)) return 'roots must be an array';
    return null;
  },

  record_finding: (p) => {
    const finding = p.finding as Record<string, unknown> | undefined;
    if (!finding || typeof finding !== 'object') {
      return 'finding is required and must be an object';
    }
    const cat = finding.category;
    if (typeof cat !== 'string' || !FINDING_CATEGORIES.has(cat)) {
      return `category must be one of: ${[...FINDING_CATEGORIES].join(', ')}`;
    }
    const sev = finding.severity;
    if (typeof sev !== 'string' || !SEVERITIES.has(sev)) {
      return `severity must be one of: ${[...SEVERITIES].join(', ')}`;
    }
    const conf = finding.confidence;
    if (conf !== undefined && conf !== null) {
      if (typeof conf !== 'number' || !Number.isInteger(conf) || conf < 1 || conf > 10) {
        return 'confidence must be an integer between 1 and 10';
      }
    }
    return requireString(finding as Record<string, unknown>, 'title')
      ?? requireString(finding as Record<string, unknown>, 'description');
  },

  // --- Web tools ---
  web_search: (p) => {
    return requireString(p, 'query')
      ?? numberInRange(p, 'maxResults', 1, 20);
  },

  fetch_url: (p) => {
    const urlErr = requireString(p, 'url');
    if (urlErr) return urlErr;
    try {
      const parsed = new URL(p.url as string);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `URL must use http or https protocol (got ${parsed.protocol})`;
      }
    } catch {
      return 'url must be a valid URL';
    }
    return null;
  },

  // --- Knowledge tools ---
  list_references: () => null,

  load_reference: (p) => {
    const keyErr = requireString(p, 'key');
    if (keyErr) return keyErr;
    const key = p.key as string;
    if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
      return 'key must not contain path traversal characters';
    }
    return null;
  },

  // --- Meta tools ---
  switch_to_fast_model: () => null,

  assemble_output: (p) => {
    if (!p.sections || typeof p.sections !== 'object') {
      return 'sections is required and must be an object';
    }
    return null;
  },

  tool_search: (p) => {
    return requireString(p, 'query');
  },
};
