# Radar: AI-Powered Codebase Assessment

## What It Does

Radar is an AI agent that investigates client codebases and produces structured, evidence-backed assessment reports. It replaces the manual discovery phase of consulting engagements — the part where a senior engineer spends days reading code, tracing architecture decisions, and cataloging risks before the team can scope real work.

Give Radar a repository. In under 10 minutes, it returns a scored report with findings, evidence, and an executive summary ready for a practice lead conversation.

## Why It Matters

The first 1-2 weeks of every new engagement are spent on discovery. A senior consultant reads the codebase, interviews the team, writes up findings in a deck. This work is essential but expensive, manual, and inconsistent across consultants.

Radar compresses codebase discovery from days to minutes. The consultant still owns the narrative and the recommendations — Radar handles the reading.

**For practice leads:** Faster scoping, lower pre-engagement cost, consistent quality across assessments.

**For delivery teams:** Day-one context instead of week-two context. Onboarding briefs, architecture maps, security reviews, and dependency audits available before the first standup.

**For sales:** A live demo that shows a prospect's own repository analyzed in real time. Nothing sells capability like showing the work.

## How It Works

Radar is an agentic tool, not a static linter. It decides what to investigate based on what it finds — there is no fixed pipeline. A Next.js monorepo gets different treatment than a single-page Sitecore app.

**Investigation phase:** An AI model (Claude Sonnet) reads files, traces dependencies, checks configurations, analyzes route structures, and searches for patterns. It uses 23 specialized tools — all deterministic, all read-only.

**Writing phase:** A faster model (Claude Haiku) records findings with evidence and assembles the report. Dual-model architecture keeps cost low without sacrificing investigation quality.

**Output:** Scored scorecard, prioritized findings with file-level evidence, executive summary, and a full investigation log showing every step the agent took.

## Assessment Types

Nine goal types covering the full engagement lifecycle:

| Type | Use Case | Output |
|------|----------|--------|
| **Onboarding** | New team member joining a project | 12-section brief with architecture, patterns, gotchas |
| **Audit** | CMS-specific architecture assessment | Scored scorecard + categorized findings |
| **Audit (Generic)** | Stack-agnostic architecture assessment | 8-category scorecard + findings |
| **Security Review** | Security posture evaluation | 6-category security scorecard, secrets archaeology |
| **Next.js Health** | Framework-specific deep dive | 7-category framework scorecard |
| **Accessibility** | WCAG 2.1 AA compliance check | 6-category a11y scorecard |
| **CI Check** | PR-level quick scan | Pass/fail for CI pipelines, compact PR comment |
| **Migration** | Upgrade readiness | Migration hotspots + complexity assessment |
| **Component Map** | Component inventory | Structured component map |

For multi-goal runs, Radar chains a core investigation with specialist passes (Next.js, accessibility) using deterministic budget planning — no wasted compute on irrelevant analysis.

## By the Numbers

Validated across 15 runs on 5 public repositories (Sitecore XM Cloud, Optimizely SaaS, Vercel Commerce, Adobe AEM, Refine):

- **Cost:** $1-2 per assessment (avg $1.38)
- **Time:** 2-10 minutes per repo (avg 6 min)
- **Findings:** 6-12 per run (avg 10), every finding backed by file-level evidence
- **Reliability:** 100% crash-free, 100% hallucination-free across all validation runs
- **Evidence quality:** 0 unverifiable evidence items across 185 total evidence citations

## Engagement Lifecycle Fit

```
Prospect call                Radar live demo on their repo
  |                              |
  v                              v
Pre-engagement    ──────>    Radar audit report (minutes, ~$2)
  |                          vs. manual discovery (days, $5-15K)
  |                              |
  v                              v
Scoping           ──────>    Practice lead reviews scored findings,
  |                          scopes engagement from evidence
  v
Delivery          ──────>    Radar onboarding brief for new team,
  |                          CI integration for ongoing monitoring
  v
Ongoing           ──────>    Radar CI checks on every PR,
                             trend tracking across runs
```

**Pre-engagement:** Run Radar on the prospect's repo during or after the sales call. Share the PDF report. The prospect sees specific, evidence-backed findings about their own code — not a generic capabilities deck.

**Scoping:** Practice leads review the scored report to identify real work. Findings have severity, category, and evidence — the raw material for SOW line items.

**Delivery:** Onboarding briefs give new team members day-one context. Multi-goal runs cover architecture, security, and accessibility in a single command.

**Ongoing:** CI integration runs Radar on every PR. Quality gates block merges on critical findings. Trend tracking shows improvement over time.

## Technical Details

- **Provider-agnostic:** Works with any OpenAI-compatible API (AWS Bedrock via Portkey, Azure OpenAI, direct OpenAI, any compatible endpoint). No vendor lock-in.
- **Read-only:** Radar never writes to the target repository. All 23 tools are deterministic, read-only functions.
- **Dashboard:** Next.js dashboard for interactive report browsing, run history, PDF export. Runs locally or deployed.
- **CLI:** `radar analyze --repo <path>` with flags for goal type, budget, output format, CI integration.
- **CI/CD:** Native GitHub Actions and Azure DevOps adapters. PR comments, SARIF upload, quality gates, trend tracking.

## What Radar Is Not

Radar is not a replacement for senior engineering judgment. It does not write SOWs, make recommendations about team structure, or tell a client what to do. It reads code and reports what it finds — with evidence. The consultant interprets the findings and owns the conversation.
