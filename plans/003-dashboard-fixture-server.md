---
id: 003
title: Dashboard fixture server for deterministic E2E
status: done
completed: 2026-05-27
reviewed: false
qa: automated
blocked-by: [002]
needs-review: none
created: 2026-05-27
---

## Requirements

Playwright tests need deterministic data to assert against. The dashboard currently loads data from disk (persisted run JSON files) and from live agent sessions. Tests must run without an LLM, without real repos, and produce the same results every time. This plan creates a fixture/seed data layer that pre-populates the dashboard with known runs, findings, and scorecards.

**Acceptance criteria:**

- [ ] A `dashboard/tests/fixtures/` directory contains at least 2 pre-built run JSON files representing completed analysis runs (one `audit` goal, one `onboarding` goal)
- [ ] Fixture runs include: findings (3+ with varying severity), scorecard with scored categories, brief markdown, investigation timeline events, metrics
- [ ] A test helper (`dashboard/tests/e2e/helpers/seed.ts`) copies fixture files to the dashboard's `output/` directory before tests and cleans up after
- [ ] A Playwright `globalSetup` or `beforeAll` hook seeds the data so every test file starts with known state
- [ ] The dashboard loads and displays the fixture data correctly (verifiable by running the smoke test against seeded data)

## Design

**Files expected to change:**

- `dashboard/tests/fixtures/run-audit-fixture.json` — new, a complete RunResult for an audit goal
- `dashboard/tests/fixtures/run-onboarding-fixture.json` — new, a complete RunResult for an onboarding goal
- `dashboard/tests/e2e/helpers/seed.ts` — new, copies fixtures to output dir
- `dashboard/tests/e2e/helpers/cleanup.ts` — new, removes seeded data after tests
- `dashboard/playwright.config.ts` — add globalSetup/globalTeardown pointing to seed/cleanup
- `dashboard/tests/e2e/smoke.spec.ts` — update to verify fixture data renders

**Approach:**

- Fixtures are static JSON files matching the `RunRecord` type from `dashboard/src/lib/agentSession.ts` (which includes `RunResult`, `StepEvent[]`, and metadata)
- The dashboard persists runs to `dashboard/output/runs/{id}/` using tiered storage (envelope.json, findings.json, events.json). The seed helper replicates this directory structure.
- The seed helper uses `fs.mkdirSync` + `fs.writeFileSync` to create `dashboard/output/runs/{fixture-id}/` directories with the 3 tiered files
- Fixtures are hand-crafted JSON (not exported from real runs) with sanitized paths and deterministic IDs (e.g., `fixture-audit-001`, `fixture-onboarding-001`)
- Use `test.describe.configure({ mode: 'serial' })` for tests that depend on seed state
- Sanitization rules: use relative paths only, no API keys, use `example-repo` for repo names, use fixed ISO timestamps

**Out of scope:** Live SSE streaming fixtures (plan 005), multi-goal run fixtures (future), CI integration (plan 010).

## Tasks

1. Create `dashboard/tests/fixtures/run-audit-fixture/` directory with 3 files:
   - `envelope.json` — `RunEnvelope` with id `fixture-audit-001`, goal `audit`, repoName `example-repo`, scorecard with 3 categories (red/yellow/green), findingsSummary with 4 entries
   - `findings.json` — array of 4 findings with varying severity (critical, high, medium, low), each with: id, title, severity, category, description, evidence, filePath
   - `events.json` — array of 10 `StepEvent` objects: 5 tool_call, 4 record_finding, 1 run_complete
2. Create `dashboard/tests/fixtures/run-onboarding-fixture/` with same structure but goal `onboarding`, 3 findings, different scorecard scores
3. Create `dashboard/tests/e2e/helpers/seed.ts` that:
   - Reads fixture directories from `../fixtures/`
   - Creates `dashboard/output/runs/{fixture-id}/` for each fixture
   - Copies envelope.json, findings.json, events.json into the run directory
   - Creates `dashboard/output/runs/index.json` listing the fixture runs
4. Create `dashboard/tests/e2e/helpers/cleanup.ts` that removes all `dashboard/output/runs/fixture-*` directories
5. Wire seed/cleanup into `playwright.config.ts` as globalSetup/globalTeardown (ESM exports: `export default async function setup()`)
6. Update smoke test to verify fixture data appears in the UI (assert run list shows 2 entries)

## Verification

- [cmd] `cd dashboard && npx playwright test --project=chromium tests/e2e/smoke.spec.ts`
- [assert] `ls dashboard/tests/fixtures/ | wc -l` outputs at least 2
- [assert] `ls dashboard/tests/fixtures/run-audit-fixture/ | wc -l` outputs 3 (envelope.json, findings.json, events.json)
- [cmd] `cd dashboard && node --input-type=module -e "import { seed } from './tests/e2e/helpers/seed.ts'; await seed();" && ls output/runs/fixture-audit-001/ | wc -l` outputs at least 1
