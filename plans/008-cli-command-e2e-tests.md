---
id: 008
title: CLI command E2E tests
status: done
completed: 2026-05-27
reviewed: false
qa: automated,verified
blocked-by: []
needs-review: none
created: 2026-05-27
---

## Requirements

The CLI (`radar` commands) has partial coverage via stub-agent e2e tests, but several commands lack any test: `--dry-run`, `compare`, `diff`, `tools --list`, `rules --validate`, and various flag combinations. This plan expands CLI test coverage to verify every command works correctly against fixture repos without requiring LLM calls.

**Acceptance criteria:**

- [ ] `radar analyze --repo <fixture> --dry-run` test verifies: exits 0, prints plan without executing, no output files created
- [ ] `radar analyze --repo <fixture> --goal audit --json` test verifies: exits 0, stdout is valid JSON matching expected schema
- [ ] `radar compare --repos <fixture1> <fixture2>` test verifies: exits 0, produces comparison output
- [ ] `radar diff <run-a.json> <run-b.json>` test verifies: exits 0, produces meaningful diff output
- [ ] `radar tools --list` test verifies: exits 0, lists all registered tools
- [ ] `radar rules --validate` test verifies: exits 0, validates all rule files parse correctly
- [ ] Tests are in `test/e2e/cli-commands.test.ts`
- [ ] All tests use the fixture repo and/or fixture run JSON files (no LLM needed)

## Design

**Files expected to change:**

- `test/e2e/cli-commands.test.ts` — new, CLI command test suite
- `test/fixtures/run-output-a.json` — new (if needed), fixture run output for diff command
- `test/fixtures/run-output-b.json` — new (if needed), fixture run output for diff command

**Approach:**

- Use `child_process.execFileSync` (or `execSync` with `tsx src/index.ts`) to spawn the CLI as a subprocess
- Point `--repo` at `test/fixtures/sitecore-minimal/` (already exists)
- For `radar diff`, create two fixture run JSON files with known differences:
  - `test/fixtures/run-output-a.json` — `FullExport` schema: `{ repoName, goal: "audit", scorecard: { categories: [...] }, findings: [3 items], metrics: {...} }`
  - `test/fixtures/run-output-b.json` — same structure, different scores (1 category changed from green to yellow), 1 additional finding added
- All `analyze` commands use `--dry-run` to avoid LLM calls (exits after printing plan)
- Assert exit codes, stdout content, and file system side effects
- Set short timeout (10s) since no LLM round-trips are involved
- Use `npx tsx src/index.ts` as the CLI entry point (not compiled `radar` binary)

**Out of scope:** Full agent runs (covered by existing stub-agent tests), CI-specific flags (`--github-output`, `--pr`), PDF export verification.

## Tasks

1. Create fixture run JSON files for the `diff` command
2. Write `radar analyze --dry-run` test
3. Write `radar analyze --json` test (with stub agent or dry-run mode)
4. Write `radar compare` test
5. Write `radar diff` test
6. Write `radar tools --list` test
7. Write `radar rules --validate` test
8. Run full suite and verify all pass

## Verification

- [cmd] `pnpm vitest run test/e2e/cli-commands.test.ts`
- [assert] `pnpm vitest run test/e2e/cli-commands.test.ts 2>&1 | grep "Tests"` shows all passed
- [cmd] `npx tsx src/index.ts tools --list`
