# Radar Demo Walkthrough

A guided tour of the app and codebase for the CTO demo. The dashboard is the primary demo vehicle — start there, then dip into code to explain how it works under the hood.

---

## 1. The 30-Second Pitch

Radar is an AI agent that autonomously investigates CMS codebases and produces structured, scored audit deliverables. You point it at a repo, give it a goal, and an AI agent decides what to investigate, gathers evidence, records findings, and outputs an architecture scorecard with actionable recommendations. It will soon integrate into CI/CD pipelines, posting findings to PRs and enforcing quality gates.

---

## 2. Demo Script (Dashboard Flow)

### Scene 1: The Starting Screen

Open the dashboard. The audience sees:

- A clean form: **repo input field**, **goal selector dropdown**, and a start button
- The goal selector has 6 options: Onboarding, Security Review, Audit, Migration, Next.js Audit, Accessibility
- A sidebar on the left with run history (including a preloaded sample run)

**What to say:** "This is the control surface. You give it a repo — either a local path or a GitHub URL — and pick what kind of analysis you want. Each goal type has its own set of domain rules the agent follows."

**Action:** Paste a GitHub URL (e.g., `https://github.com/Sitecore/xmcloud-starter-js`). If it's a GitHub URL, click "Pull Repo" — the dashboard shallow-clones it. Select **Security Review** as the goal. Click Start.

---

### Scene 2: Live Investigation (The Money Shot)

The screen splits into two panels. This is where the agent's autonomy is visible.

**Left panel — Agent reasoning stream:**

- The agent's thinking appears in real time as it streams
- Below each reasoning block, colored chips show which tools are being called (e.g., `read_file`, `grep_pattern`, `analyze_route_structure`)
- A phase indicator at the top shows progress: **Analyzing → Switching → Recording → Assembling → Complete**
- A progress bar fills as the tool call budget is consumed
- Elapsed time ticks in the corner

**Right panel — Live findings and file tree:**

- **Files Examined** section grows as the agent reads files — you can see it building a mental model of the codebase
- **Findings** section populates in real time as the agent discovers issues — each with a severity badge (critical/high/medium/low)
- **Score** panel at the bottom shows a live red/yellow/green indicator with severity counts

**What to say during this scene:**

- "Watch the tool calls — it's reading package.json first, identifying the stack, then deciding where to dig based on what it finds. There's no hardcoded sequence."
- "It just found a security issue — look at the finding card on the right. It has the file path, line number, and the actual code snippet as evidence."
- "Now it's calling `switch_to_fast_model` — it decided it's done investigating and is switching to a cheaper model to write up the results. That switch saves about 37% on cost."

**If budget runs out:** A modal appears offering "Extend +50 calls" or "Finish & Generate Report." This shows the budget control system.

---

### Scene 3: The Results

When the run completes, the view switches to a tabbed results screen.

**Report tab (default):**

- **Scorecard grid** at the top — overall score (red/yellow/green) plus per-category scores (Architecture, Security, Dependencies, CMS Integration, etc.)
- **Top 3 risks** highlighted with severity badges
- **Full markdown report** below — the structured brief with sections, findings, and recommendations
- Export buttons: "Copy Markdown" and "Export .md"

**What to say:** "This is the deliverable. Scorecard at the top, prioritized risks, then the full narrative. Every finding has file-level evidence — it's not hand-waving."

**Events tab:**

- The full event stream — every tool call, every reasoning step, every finding recorded
- "This is the audit trail. You can see exactly what the agent did, in what order, and why."

**Rules tab:**

- Shows the actual markdown rules the agent followed for this goal/platform combination
- "These are the domain rules. They're plain markdown. A senior architect can edit these without touching code. That's how you add expertise to the agent."

**Cost tab:**

- Total cost, duration, tool calls, models used
- Per-model breakdown: input tokens, output tokens, cached tokens, cost
- "This run cost [X]. The dual-model pattern — Sonnet for investigation, Haiku for writing — is what keeps it under a dollar."

---

### Scene 4: Comparison (If Time Allows)

Click "Compare" in the sidebar. Select two historical runs (e.g., Sitecore vs. Optimizely, or two runs of the same repo at different points).

**Scorecard tab:**

- Side-by-side overall scores with per-category delta (+1 improvement in green, -1 regression in red)

**Findings tab:**

- Three sections: **New findings** (issues that appeared), **Resolved findings** (issues that went away), **Persistent findings** (still there)
- Fingerprint-based diffing — no database needed

**What to say:** "This is how you track drift over time. Run it on the same repo every sprint, and you see what got better, what got worse, and what's still unresolved. In CI, this happens automatically on every PR."

---

### Scene 5: Sidebar History

Point out the sidebar:

- Every run is saved and replayable
- Click any historical run to replay its event stream or jump straight to results
- "This is your run history. Every analysis is persisted. You can replay any past run, compare runs, or export results."

---

## 3. Architecture Deep-Dive (For Follow-Up Questions)

After the live demo, if the CTO wants to understand how it works under the hood:

### The Core Principle

> **Tools are deterministic. Orchestration is agentic. Rules are human-authored. Outputs are structured.**

There is no hardcoded pipeline. The AI agent decides what to investigate and in what order, using four layers:

| Layer | What it does | Where it lives |
| --- | --- | --- |
| **Tools** | Pure functions that read code and return facts. Never call an LLM. | `src/tools/` (23 tools) |
| **Rules** | Plain English markdown files that tell the agent _how_ to investigate. | `src/rules/` (17 files) |
| **References** | Static knowledge base files the agent loads selectively. | `src/references/` (15 files) |
| **Output** | Structured renderers that format findings into deliverables. | `src/output/` (8 files) |

The agent runtime (Pi Agent) sits in the middle, calling tools, following rules, and assembling output.

### How a Run Works Under the Hood

1. **System prompt assembly** (`src/agent/systemPrompt.ts`) — loads and concatenates core rules + platform rules + goal rules from markdown files
2. **Agent loop starts** (`src/agent/runner.ts`) — Pi Agent enters an autonomous observe → reason → act loop with the 23 registered tools and a tool call budget
3. **Investigation** — the agent calls tools in parallel batches, adapting its approach based on what it discovers
4. **Model switch** — the agent calls `switch_to_fast_model` when it decides investigation is complete, switching from Sonnet to Haiku
5. **Output assembly** — evidence verification (deterministic, no LLM), deduplication, scorecard computation, rendering
6. **CI integration** (if in a pipeline) — auto-detects GitHub Actions or Azure DevOps, posts findings to PRs, evaluates quality gates

---

## 4. The Tools (23 Total)

Tools are the agent's senses. They read code and return structured data. They never call an LLM and never make judgments — that's the agent's job.

### Repo Access

| Tool               | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `list_directory`   | List files and directories, detect binary files        |
| `read_file`        | Read a file with caching and path suggestions on error |
| `read_files_batch` | Read multiple files in parallel                        |

### Search

| Tool           | What it does                                              |
| -------------- | --------------------------------------------------------- |
| `grep_pattern` | Regex search across files (ripgrep with Node.js fallback) |
| `find_files`   | Find files by glob pattern                                |

### Config Parsing

| Tool                 | What it does                                 |
| -------------------- | -------------------------------------------- |
| `parse_package_json` | Extract dependencies, scripts, workspaces    |
| `parse_next_config`  | Parse Next.js configuration                  |
| `parse_tsconfig`     | Extract TypeScript settings and path aliases |
| `parse_env_file`     | Parse .env files (values redacted)           |
| `check_gitignore`    | Check if patterns are gitignored             |

### Dependencies

| Tool                 | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `query_npm_versions` | Fetch latest npm versions (cached 24h)              |
| `compare_versions`   | Compare installed vs. latest, classify semver drift |

### Code Analysis

| Tool                           | What it does                                             |
| ------------------------------ | -------------------------------------------------------- |
| `analyze_route_structure`      | Map Next.js app/pages routes, detect router type         |
| `analyze_component_directives` | Scan for `'use client'` / `'use server'` boundaries      |
| `analyze_env_usage`            | Find environment variable references across the codebase |
| `analyze_middleware`           | Parse middleware.ts for auth and site resolver patterns  |
| `detect_app_roots`             | Identify app roots in monorepos                          |
| `detect_scope_drift`           | Check monorepo package boundaries                        |

### Findings

| Tool                     | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `record_finding`         | Record a finding with evidence, severity, confidence, and fingerprint |
| `verify_evidence`        | Verify finding evidence against actual file content                   |
| `get_specialist_prompts` | Load specialist rules for specific domains (GraphQL, Tailwind, etc.)  |

### Web

| Tool         | What it does                             |
| ------------ | ---------------------------------------- |
| `web_search` | Search approved documentation sources    |
| `fetch_url`  | Fetch a URL and convert HTML to markdown |

### Agent Control

| Tool                   | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `switch_to_fast_model` | Signal investigation is done, switch to cheaper model |
| `assemble_output`      | Write structured sections for the final deliverable   |

---

## 5. The Rules (Human-Authored Markdown)

Rules are what make this a domain-expert agent rather than a generic code analyzer. They are plain markdown files that any senior developer can edit.

### Core Rules (`src/rules/core.md`)

Loaded on every run. Defines:

- Where to start (always read package.json first)
- Investigation priorities (preview mode is #1 escalation source)
- Finding standards (minimum 8 findings, every category needs at least one)
- Evidence integrity (you can only cite files you've actually read)
- Confidence calibration (1-10 scale based on evidence strength)

### Goal Rules (one per goal type)

Each goal type has its own investigation playbook:

- `goal-audit.md` — architecture assessment with scored categories
- `goal-security-review.md` — 6-category security audit
- `goal-onboarding.md` — 12-section developer onboarding brief
- `goal-nextjs.md` — Next.js framework health check
- `goal-accessibility.md` — WCAG 2.1 AA compliance review
- `goal-migration.md` — upgrade readiness assessment
- `goal-ci-check.md` — fast CI health check (15 tool calls max)
- `goal-component-map.md` — component inventory

### Platform Rules (one per CMS)

- `platform-sitecore.md` — Sitecore XM Cloud / JSS patterns
- `platform-optimizely.md` — Optimizely SaaS CMS patterns

### Specialist Rules (`src/rules/specialists/`)

Loaded on demand when the agent detects specific technologies:

- `graphql.md`, `tailwind.md`, `prisma.md`, `nextjs.md`, `cms-sitecore.md`, `cms-optimizely.md`

**Key point for the demo:** Adding a new audit type means writing a markdown file. No code changes. One architecture, many deliverables.

---

## 6. Evidence Verification (Anti-Hallucination)

LLMs can fabricate code snippets, especially after long conversations push the original file reads out of context. Radar has a built-in defense:

1. When the agent calls `record_finding`, the tool checks that every cited file was actually read during the run (via `fileReadCache` on `AgentState`).
2. The `snippet` field is compared against the real file content. If it doesn't match, the system auto-corrects to the actual code.
3. After the agent loop completes, a post-loop `verify_evidence` pass re-checks all findings against disk.
4. Findings with unverifiable evidence are dropped before scoring.

This is deterministic — no LLM involved in verification. It's pure string matching against the file system.

---

## 7. Dual-Model Cost Optimization

The agent uses two models in sequence:

| Phase | Model | Role | Cost |
| --- | --- | --- | --- |
| Investigation | Claude Sonnet 4.6 | Reasoning, tool selection, evidence gathering | ~$3/M input tokens |
| Writing | Claude Haiku 4.5 | Recording findings, assembling the brief | ~$0.25/M input tokens |

The switch is **agent-initiated** — the agent calls `switch_to_fast_model` when it decides it's done investigating. Fallbacks ensure the switch happens even if the agent forgets:

- At 50% budget remaining: a steering message reminds the agent
- At 5 calls remaining: the runner force-switches

A context compression ("snip boundary") drops ~60% of investigation context before the writing phase, since the agent no longer needs the raw file contents.

Typical cost: **under $0.75 per 45-call run.**

---

## 8. Provider-Agnostic Model Layer

`src/config/piModel.ts` builds the model configuration entirely from environment variables:

```
PORTKEY_API_KEY=...
PORTKEY_BASE_URL=...
PORTKEY_PROVIDER=@aws-bedrock-use2
AGENT_MODEL=us.anthropic.claude-sonnet-4-6
FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

To switch providers (e.g., a client wants to use their own Azure OpenAI subscription), you change the env vars. No code changes. The model IDs and gateway URL are config, not code.

Currently routing through Portkey AI gateway to Amazon Bedrock. Portkey handles the protocol translation — Pi Agent speaks OpenAI-compatible API, Portkey routes to Bedrock.

---

## 9. CI/CD Integration

`src/ci/` contains platform adapters that auto-detect the environment:

| Platform           | Adapter                 | Detection                                    |
| ------------------ | ----------------------- | -------------------------------------------- |
| GitHub Actions     | `src/ci/github.ts`      | `GITHUB_ACTIONS` env var                     |
| Azure DevOps       | `src/ci/azureDevops.ts` | `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` env var |
| Generic (fallback) | `src/ci/adapter.ts`     | Always available                             |

The orchestrator (`src/ci/orchestrator.ts`) runs post-analysis:

1. Download previous run artifacts (for trend tracking)
2. Diff findings by fingerprint (new / resolved / persistent)
3. Post PR comment with scorecard and finding diff
4. Add file-level annotations
5. Upload SARIF for code scanning
6. Apply labels (`radar:security-risk`, `radar:clean`, etc.)
7. Upload run artifacts for next-run comparison
8. Fire webhooks (Slack/Teams notifications)
9. Evaluate quality gate (exit code)

Fingerprint-based trend tracking works without a database. Each finding gets `SHA-256(category + filePath + normalizedTitle)`. Diff two runs by set intersection.

---

## 10. Test Coverage

219 tests across 80+ files:

| Category                      | Coverage                                                  |
| ----------------------------- | --------------------------------------------------------- |
| **Tool tests** (49 files)     | Every tool: happy path + error cases                      |
| **Output tests** (8 files)    | Brief, scorecard, JSON, SARIF, CI comment rendering       |
| **CI tests** (7 files)        | Platform adapters, orchestration, quality gates, webhooks |
| **Agent tests** (4 files)     | System prompt assembly, retry logic, step events          |
| **Security tests** (2 files)  | Prompt injection defense, secret redaction                |
| **E2E tests** (3 files)       | Full agent loop with stubbed tools                        |
| **Dashboard tests** (3 files) | Session management, API routes                            |

Test fixture: `test/fixtures/sitecore-minimal/` — a minimal Sitecore XM Cloud project.

---

## 11. Key Files to Show (If Diving Into Code)

If the CTO asks "show me the code," these files tell the story:

| What to show | File | Why |
| --- | --- | --- |
| Agent loop | `src/agent/runner.ts` | How the agent runs, budget management, model switching |
| System prompt assembly | `src/agent/systemPrompt.ts` | How rules get loaded and combined |
| A domain rule | `src/rules/core.md` | Human-readable investigation standards |
| A goal rule | `src/rules/goal-audit.md` | How a goal type defines its scope |
| Tool registry | `src/tools/piToolAdapter.ts` | How tools are registered with typed schemas |
| A simple tool | `src/tools/config/parsePackageJson.ts` | Deterministic, no LLM, returns facts |
| Evidence verification | `src/tools/analysis/recordFinding.ts` | Anti-hallucination at record time |
| Model config | `src/config/piModel.ts` | Provider-agnostic, env-var-driven |
| CI orchestrator | `src/ci/orchestrator.ts` | Post-analysis automation |

---

## 12. Anticipated Questions

**Q: How is this different from a linter or SonarQube?** A: Linters check syntax rules. SonarQube checks code quality patterns. Radar reasons about architecture — it understands that a Sitecore editing integration has three parts that need to be wired together, or that a specific dependency version is incompatible with the Next.js App Router. It reads code the way an experienced engineer would, not the way a pattern matcher does.

**Q: Can it hallucinate findings?** A: The evidence verification system prevents this. Every finding must cite files that were actually read during the run, and every code snippet is verified against the real file content. Findings that can't be verified are dropped before scoring.

**Q: How much does it cost per run?** A: Under $0.75 for a typical 45-call run with the dual-model optimization. The investigation phase uses Sonnet (~$3/M tokens), then switches to Haiku (~$0.25/M tokens) for writing.

**Q: Can we add new audit types?** A: Yes — write a markdown file with domain rules, add a goal type entry. No code changes to the agent, tools, or output layer. The platform pattern: one architecture, many deliverables.

**Q: Is it tied to AWS/Bedrock?** A: No. The model layer is provider-agnostic. Change the env vars to point at Azure OpenAI, a direct Anthropic API key, or any OpenAI-compatible endpoint. The code doesn't change.

**Q: Can it fix the issues it finds?** A: Not yet — currently it's read-only investigation and reporting. But because it already has file-level evidence for every finding, extending it to propose or apply fixes is a natural next step.

**Q: How does it handle large/complex repos?** A: It has a tool call budget (default 45) and the agent prioritizes what to investigate based on the rules. For monorepos, `detect_app_roots` identifies the main application workspace first. Budget extension is available interactively or auto-wraps in CI.

**Q: What platforms does it support?** A: Sitecore XM Cloud (JSS + Next.js) and Optimizely SaaS CMS (Next.js) today. The platform rules are modular — adding a new CMS platform means adding a `platform-*.md` rule file and corresponding reference files.

**Q: How does the comparison/trend tracking work without a database?** A: Every finding gets a fingerprint — `SHA-256(category + filePath + normalizedTitle)`. To diff two runs, you compare fingerprint sets. New = only in current run, resolved = only in previous run, persistent = in both. In CI, the previous run's JSON is stored as a pipeline artifact and downloaded for comparison on the next run.
