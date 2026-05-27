---
id: 001
title: Integrate CodeGraph as code intelligence layer for investigation phase
status: blocked
blocked-by: []
priority:
allows-migrations: false
needs-review: none
created: 2026-05-27
---

## Requirements

The investigation phase (Sonnet) currently spends 15-30 tool calls on grep/read/list
operations to build a mental model of the target codebase. This is token-expensive and
can only find textual matches — it cannot answer "who calls this function?" or "what
breaks if I change this?" without manually tracing through files.

Adding CodeGraph as a code intelligence layer gives the agent pre-indexed symbol graphs,
call trees, and impact analysis. The target repo is indexed once at the start of a run
(~10-30s), then the agent queries the graph instead of grinding through files.

**Acceptance criteria:**

- [ ] `CODEGRAPH` env var controls behavior: `auto` (default), `true`, `false`
- [ ] `auto` mode: detect `codegraph` on PATH, use if found, skip silently if not
- [ ] `true` mode: require codegraph — fail fast with clear error if missing
- [ ] `false` mode: skip entirely even if installed (saves indexing time)
- [ ] When enabled: target repo is indexed automatically before the agent loop starts
- [ ] Startup logs one status line: enabled/disabled/not-found
- [ ] 4 new tools registered with Pi agent: `codeGraphContext`, `codeGraphSearch`, `codeGraphCallers`, `codeGraphImpact`
- [ ] Each tool is deterministic (returns facts, no LLM calls) per project conventions
- [ ] Existing tools (readFile, searchCode, listFiles) remain available as fallbacks
- [ ] Agent can use CodeGraph tools in any goal type (not goal-specific)
- [ ] Indexing failure is non-fatal — agent falls back to existing tools with warning
- [ ] Unit tests cover happy path + error/unavailable cases for each new tool
- [ ] Node.js upgraded to 22 LTS (.nvmrc added)
- [ ] No new production dependencies added

## Design

**Architecture:** CodeGraph is used via CLI subprocess, NOT as a library import.
The npm package ships as a self-contained binary (like esbuild/turbo) with its own
bundled Node 24 runtime. It has no `main`/`exports`/`types` — the only stable API
is the CLI. Each tool wraps `execFile('codegraph', [...args, '--json'])` and parses
JSON stdout.

```
┌─────────────────────────────────────────────────────────────┐
│  Agent (Pi, running on Node 22)                             │
│                                                             │
│  codeGraphSearch("handleLogin")                             │
│       │                                                     │
│       ▼                                                     │
│  execFile('codegraph', ['query', 'handleLogin',             │
│           '--json', '--path', repoRoot])                    │
│       │                                                     │
│       ▼                                                     │
│  Parse JSON stdout → return typed result                    │
└─────────────────────────────────────────────────────────────┘
        │ spawns
        ▼
┌─────────────────────────────────────────────────────────────┐
│  CodeGraph binary (bundled Node 24 + node:sqlite)           │
│  Reads .codegraph/codegraph.db → returns JSON to stdout     │
└─────────────────────────────────────────────────────────────┘
```

**Why CLI subprocess over library import:**
- The npm package has no `main`/`exports`/`types` — there is no library entry point
- Uses `node:sqlite` which requires Node 22.5+; ships its own Node 24 runtime
- CLI with `--json` is the stable, cross-platform, officially supported interface
- ~50-100ms per subprocess spawn is negligible vs. LLM round-trip savings

**Why upgrade Node to 22:**
- Node 20 reached EOL April 2026 — security risk to stay
- All dependencies support Node 22 (Pi Agent requires >=20.0.0)
- Gets native fetch, better performance, Web Streams API
- Not required for CodeGraph (it bundles its own runtime) but good hygiene

**Files expected to change:**

- `.nvmrc` — new file: pin `22` (Node 22 LTS)
- `package.json` — add `engines.node: ">=22.0.0"`, add `@colbymchenry/codegraph` as devDependency (for `codegraph` binary on PATH during dev/CI)
- `src/tools/codeGraph/detect.ts` — PATH detection (`which()`) + CODEGRAPH setting parser
- `src/tools/codeGraph/execCodeGraph.ts` — shared helper: spawn codegraph CLI, parse JSON, handle errors
- `src/tools/codeGraph/codeGraphSearch.ts` — new tool: wraps `codegraph query <search> --json`
- `src/tools/codeGraph/codeGraphContext.ts` — new tool: wraps `codegraph context <task> --format json`
- `src/tools/codeGraph/codeGraphCallers.ts` — new tool: wraps `codegraph callers <symbol> --json`
- `src/tools/codeGraph/codeGraphImpact.ts` — new tool: wraps `codegraph impact <symbol> --json`
- `src/tools/codeGraph/index.ts` — barrel export
- `src/tools/piToolAdapter.ts` — register the 4 new tools
- `src/agent/runner.ts` — add indexing step before agent loop (via `execFile`)
- `test/tools/codeGraph/codeGraphSearch.test.ts` — unit tests
- `test/tools/codeGraph/codeGraphContext.test.ts` — unit tests
- `test/tools/codeGraph/codeGraphCallers.test.ts` — unit tests
- `test/tools/codeGraph/codeGraphImpact.test.ts` — unit tests

**CLI commands mapped to tools:**

```
Tool                  CLI command
─────────────────────────────────────────────────────────────────────
codeGraphSearch       codegraph query <search> --json --path <repo> [--kind <k>] [--limit <n>]
codeGraphContext      codegraph context <task> --format json --path <repo> [--max-nodes <n>]
codeGraphCallers      codegraph callers <symbol> --json --path <repo> [--limit <n>]
codeGraphImpact       codegraph impact <symbol> --json --path <repo> [--depth <n>]
```

**Shared subprocess helper (`execCodeGraph.ts`):**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CODEGRAPH_BIN = process.env.CODEGRAPH_BIN || 'codegraph';
const TIMEOUT_MS = 30_000;

export interface CodeGraphResult<T> {
  ok: true; data: T;
} | {
  ok: false; error: string;
}

export async function execCodeGraph<T>(
  args: string[],
  repoPath: string,
): Promise<CodeGraphResult<T>> {
  try {
    const { stdout } = await exec(
      CODEGRAPH_BIN,
      [...args, '--path', repoPath],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    return { ok: true, data: JSON.parse(stdout) as T };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
```

**CODEGRAPH setting (in .env, alongside AGENT_MODEL/FAST_MODEL):**

```bash
# .env
CODEGRAPH=auto    # auto (default) | true | false
```

| Value | Behavior |
|-------|----------|
| `auto` | Detect `codegraph` on PATH → use if found, skip if not |
| `true` | Require it — throw on startup if missing |
| `false` | Skip entirely — no detection, no indexing |

**Detection + indexing lifecycle (in runner.ts):**

```typescript
import { which } from '../tools/codeGraph/detect.js';

const cgSetting = (process.env.CODEGRAPH || 'auto').toLowerCase();
let codeGraphAvailable = false;
const skipForGoal = config.goal === 'ci-check' && cgSetting === 'auto';

if (cgSetting !== 'false' && !skipForGoal) {
  const found = await which('codegraph');

  if (!found && cgSetting === 'true') {
    throw new Error('CODEGRAPH=true but codegraph not found on PATH. Install: npm i -g @colbymchenry/codegraph');
  }

  if (found) {
    try {
      const t0 = Date.now();
      // Use spawn (not execFile) to stream stderr progress to dashboard
      await spawnWithProgress('codegraph', ['init', '--index', '--path', config.repoPath], {
        timeout: 120_000,
        onProgress: (line) => config.onStep?.({
          step: 0, action: 'codegraph_index', type: 'progress', result: line,
        }),
      });
      codeGraphAvailable = true;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      logger.info(`CodeGraph: enabled (indexed in ${elapsed}s)`);
    } catch (err) {
      logger.warn('CodeGraph: indexing failed, graph tools unavailable', { err });
    }
  } else {
    logger.info('CodeGraph: not found (install: npm i -g @colbymchenry/codegraph)');
  }
} else {
  logger.info('CodeGraph: disabled (set CODEGRAPH=auto to enable)');
}

// Pass codeGraphAvailable flag to buildPiTools
```

**Tool behavior when CodeGraph is unavailable:**
- Tools return `{ error: "CodeGraph not available for this run. Use grep_pattern or read_file instead." }`
- Agent sees the error message and naturally falls back to existing tools
- No special fallback logic needed — the agent handles it via its own reasoning

**Out of scope:**
- Modifying agent prompts/rules to prefer CodeGraph tools (separate plan)
- Adding CodeGraph-specific instructions to goal rule files (separate plan)
- MCP server mode (CLI subprocess is simpler and sufficient)
- Persisting the `.codegraph/` index between runs (ephemeral per run)
- Benchmarking token savings (separate validation after integration)
- Installing CodeGraph in CI (document as a prerequisite)

## Tasks

1. Add `.nvmrc` with `22`, update `package.json` engines to `>=22.0.0`
2. Create `src/tools/codeGraph/detect.ts` — PATH detection + CODEGRAPH env parsing
3. Create `src/tools/codeGraph/execCodeGraph.ts` — shared subprocess helper
4. Create `src/tools/codeGraph/codeGraphSearch.ts` — wraps `codegraph query --json`
5. Create `src/tools/codeGraph/codeGraphContext.ts` — wraps `codegraph context --format json`
6. Create `src/tools/codeGraph/codeGraphCallers.ts` — wraps `codegraph callers --json`
7. Create `src/tools/codeGraph/codeGraphImpact.ts` — wraps `codegraph impact --json`
8. Create `src/tools/codeGraph/index.ts` — barrel export
9. Register all 4 tools in `piToolAdapter.ts` (gated by `codeGraphAvailable` flag)
10. Add CodeGraph detection + initialization to runner.ts (respects CODEGRAPH setting)
11. Add `CODEGRAPH=auto` to `.env.example` with comment
12. Write unit tests for detect, execCodeGraph, and all 4 tools
13. Run full test suite to verify no regressions on Node 22

## Verification

Checks:
- [cmd] `node --version` outputs v22.x
- [cmd] `pnpm exec tsc --noEmit` — project typechecks with new tools
- [cmd] `pnpm test -- --run` — all tests pass including new CodeGraph tool tests
- [assert] `pnpm test -- --run test/tools/codeGraph/` output contains "pass"
- [assert] `cat .nvmrc` output contains "22"

## NOT in scope

- **Agent prompt tuning** — Modifying goal rules to say "prefer CodeGraph tools" is a separate plan. The agent discovers tools via Pi's tool list and will use them when relevant.
- **Index persistence** — `.codegraph/` is ephemeral per run. Caching indexes between runs (for the same repo) would save time but adds state management complexity.
- **MCP server mode** — More complex lifecycle (keep server alive, clean shutdown). CLI subprocess is simpler and sufficient for our batch-analysis pattern.
- **Benchmarking** — Measuring actual token/cost savings requires running both paths against the same repos. Do after integration is proven.
- **CI installation of codegraph** — Document as a prerequisite. Not automated in this plan.

## What already exists

- `src/tools/search/grepPattern.ts` — text pattern search (stays as complement to graph)
- `src/tools/search/findFiles.ts` — file glob search (stays)
- `src/tools/repo/readFile.ts` — file reading (stays — CodeGraph returns snippets but agent may need full files)
- `src/tools/repo/listDirectory.ts` — directory listing (stays)
- `src/agent/runner.ts` — already has a pre-agent-loop setup phase (preCompute) where indexing naturally fits
- `.env.example` — already documents AGENT_MODEL, FAST_MODEL, PROVIDER_TYPE pattern

## Failure modes

| Codepath | Failure scenario | Test? | Handling? | User sees? |
|----------|-----------------|-------|-----------|------------|
| Detection | `codegraph` not on PATH | Yes (mock) | Returns null | Log: "not found" |
| Detection | CODEGRAPH=true + missing | Yes (mock) | Throws | Startup error with install instructions |
| Indexing | Repo too large (timeout) | Yes (mock) | catch → warn | Log: "timed out, skipping" |
| Indexing | Corrupt repo / no git | Yes (mock) | catch → warn | Log: "failed, skipping" |
| Query | Symbol not found | Yes (mock) | Returns empty | Agent sees empty results, uses grep |
| Query | codegraph crashes mid-query | Yes (mock) | Returns error | Agent sees error, uses fallback tool |
| Query | stdout not valid JSON | Yes (mock) | Returns error | Agent sees parse error |

No critical gaps — all failure modes have error handling and tests.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. All steps touch `src/tools/codeGraph/` and `src/agent/runner.ts` — a single lane of work.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** ENG CLEARED — ready to implement.

### Completion Summary
- Step 0: Scope Challenge — scope accepted as-is (14 files, 1 new pattern)
- Architecture Review: 3 issues found (library-vs-CLI showstopper caught pre-implementation, distribution model resolved, progress streaming added)
- Code Quality Review: 0 issues (DRY handled by shared helper, matches existing convention)
- Test Review: diagram produced, 28 paths identified, all covered by mocked unit tests
- Performance Review: 1 issue found (ci-check skip), resolved
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items (no new TODOs needed)
- Failure modes: 0 critical gaps (all 7 scenarios have handling + tests)
- Parallelization: 1 lane, sequential
- Lake Score: 3/3 recommendations chose complete option
