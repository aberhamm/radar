# Evidence Verification in Agentic Systems

A technical reference on how LLM-based agent systems verify that their outputs are grounded in actual tool results. Covers the full taxonomy of approaches, what production systems ship, academic research, and where the industry has a blind spot.

---

## The problem

An agentic coding system reads files, runs searches, and executes commands — then makes claims about what it found. The LLM might say "package.json uses React 16.8" when the file actually shows React 18.2. It might cite a file it never read. It might produce a code snippet that looks plausible but doesn't exist in the codebase.

This is different from the hallucination problem in chatbots. A chatbot hallucinates from parametric memory — it invents facts it was never given. An agent hallucinates despite having the facts — it received real tool results but then misrepresents them in its output.

The distinction matters because agentic hallucination is *detectable*. The system has a record of what the agent actually read (tool call history), what the files actually contain (filesystem), and what the agent claims (output). Verification is a comparison between these three sources.

Yet most production systems don't perform this comparison. The industry has converged on verifying *code correctness* (does it compile? do tests pass?) while ignoring *claim correctness* (does the agent's narrative match reality?).

---

## Why code verification isn't enough

The dominant verification pattern in production agents is the lint-test loop: after every edit, run linters and test suites, feed errors back to the LLM, loop until clean. This works because it aligns with how humans verify code — if the tests pass, the code is probably correct.

But many agentic use cases produce *analysis*, not *code*:

- **Code review agents** describe what they found. If the description is wrong, the review is misleading.
- **Audit agents** produce findings with evidence. If the evidence is fabricated, the audit is worthless.
- **Documentation agents** describe code behavior. If the description doesn't match the code, the docs are harmful.
- **Migration planning agents** assess complexity and risk. If the assessment cites non-existent patterns, the plan is unreliable.

For these use cases, "the code compiles" is irrelevant. The output is prose with citations, and the citations need verification.

---

## Taxonomy of verification approaches

After surveying 12 production systems and the academic literature, verification approaches fall into five categories plus one gap.

### Category 1: No verification

**Systems:** AutoGPT, BabyAGI, CrewAI

**Pattern:** Trust the LLM output. No checking at any level.

**Why it exists:** The first generation of agents shipped without verification because the focus was on getting the loop working at all. CrewAI is a higher-level orchestration framework — it delegates to agents but doesn't inspect their work.

**What it catches:** Nothing.

**Risk level:** High. The output quality is entirely dependent on the model's tendency to be accurate, with no safety net. Fine for demos, dangerous for production.

### Category 2: Tool-level guardrails

**Systems:** SWE-agent (lint gate on edit), OpenCode (LSP diagnostics)

**Pattern:** The tool itself rejects invalid input or provides diagnostic feedback. Verification is embedded in the tool interface, not in a separate pass.

**When it runs:** Per-tool, at execution time.

**LLM involved:** No — purely deterministic.

**How SWE-agent does it:** The `edit` command includes an integrated syntax linter. If the proposed code change is not syntactically valid, the edit is rejected and the error is returned to the agent. The agent must fix the syntax before the edit goes through. This is a simple gate, but it prevents the most common mechanical error (broken syntax) from ever entering the codebase.

SWE-agent's broader insight (from the ACI paper, arXiv 2405.15793) is that good tool *design* prevents more errors than post-hoc verification. The 100-line file viewer prevents the agent from seeing (and therefore hallucinating about) code it hasn't scrolled to. The search tool returns file paths only (not surrounding context), reducing the surface area for misinterpretation. These are preventive, not corrective.

**How OpenCode does it:** LSP diagnostics are passively available through a `diagnostics` tool. The agent can check for type errors and linting warnings, but this isn't triggered automatically after edits — the agent must choose to call it.

**What it catches:** Syntax errors, type errors (if actively checked), malformed edits.

**What it misses:** Semantic errors, hallucinated claims about code behavior, incorrect descriptions of what code does, fabricated file references.

### Category 3: Lint-test loop

**Systems:** Aider, SWE-agent (partial), Claude Code (model-initiated), Cursor (model-initiated), Amazon Q Developer (likely), Devin (as part of autofix)

**Pattern:** After every edit, run linters and/or test suites. If they fail, feed errors back to the LLM for correction. Loop until clean or iteration limit reached.

**When it runs:** Post-tool (after each edit).

**LLM involved:** Yes — the LLM interprets errors and produces fixes. But the *verification signal* (lint/test pass/fail) is deterministic.

**How Aider does it:** Two mechanisms, both on by default:

1. *Auto-lint:* After every file edit, Aider runs linters (built-in or user-configured via `--lint-cmd`). If the linter returns non-zero, the lint errors are sent to the LLM with a prompt to fix them. The LLM produces a corrected edit, which is linted again.

2. *Auto-test:* With `--auto-test` and `--test-cmd`, the test suite runs after every edit. Test failures are fed back to the LLM. No documented iteration limit — it loops until errors resolve.

Aider also uses a *repository map* — a concise structural overview of the codebase built from tree-sitter parsing, showing function signatures, class definitions, and call relationships. Since the map is derived from actual code analysis, only real symbols and existing files appear. This implicitly grounds the LLM's context in reality — it can't hallucinate a function that doesn't appear in the repo map.

**How Claude Code does it:** No enforced verification loop. Instead, the documented agentic flow is a three-phase pattern: gather context → take action → verify results. The "verify results" phase is model-initiated — the model decides whether to run tests, re-read files, or check its work. The harness doesn't force it. Users can configure `PostToolUse` hooks to run custom verification commands, but this is opt-in configuration, not built-in behavior.

Claude Code also provides file edit checkpoints — every edit is snapshot-reversible. This is an undo mechanism, not a verification mechanism, but it limits the blast radius of unverified changes.

**How Devin does it (autofix component):** Devin's "closing the agent loop" pattern triggers auto-fixes in response to CI signals. When lint fails, tests fail, or security scanners flag issues, the agent generates fixes and re-runs. This creates a true feedback loop: agent writes → CI catches → agent fixes → CI passes.

**What it catches:** Syntax errors (lint), functional regressions (tests), type errors (type checker), security issues (scanners). This is the strongest verification signal available because it uses the same signal that SWE-bench uses to evaluate agents.

**What it misses:** Hallucinated descriptions of code behavior, fabricated evidence, claims not backed by tool results, incorrect narratives about what code does. The lint-test loop verifies that *code works*, not that *claims about code are accurate*.

**Why it dominates:** Systems that run tests after edits score highest on SWE-bench. The correlation is direct — SWE-bench evaluates by running the repo's test suite, so agents that run tests during development naturally align with the evaluation criteria.

### Category 4: LLM-as-judge / critic

**Systems:** OpenHands (Critic + Iterative Refinement), LangGraph (Reflection patterns), Devin (Devin Review)

**Pattern:** A second LLM evaluates the first LLM's output. May use rubric-based scoring, self-reflection, or multi-perspective comparison. Can trigger re-generation if quality is below threshold.

**When it runs:** Post-action or post-loop.

**LLM involved:** Yes — this is the defining characteristic.

**How OpenHands does it:** Two mechanisms:

1. *LLM-based Critic:* A dedicated critic model evaluates agent actions asynchronously after execution. Produces a numerical score (0.0–1.0), a boolean `success` flag (score >= 0.5), and optional feedback. The critic uses a rubric-supervised approach described in arXiv 2603.03800 — it's trained on real-world outcomes, not just vibes.

2. *Iterative Refinement:* When the critic score falls below a configurable threshold (default 0.6), the system auto-generates follow-up prompts requesting improvement. Retries up to `max_iterations` (default 3). This creates a verify→fix loop, but the verification signal is an LLM judgment, not a deterministic check.

OpenHands also has a *Security Analyzer* that evaluates action risk before execution (low/medium/high), blocking high-risk operations. This is a guardrail, not a verification mechanism, but it prevents some categories of harmful output.

**How LangGraph supports it:** LangGraph provides composable patterns, not built-in verification:

- *Reflection:* A generator LLM produces output, then a reflector LLM critiques it. Loops a fixed number of times. Developers build this as a graph.
- *Reflexion:* Grounds critique in external data. The actor generates citations and enumerates missing elements.
- *LATS (Language Agent Tree Search):* Combines reflection with Monte Carlo tree search — explores multiple solution trajectories, scores via reflection, uses UCB for exploration. The most sophisticated pattern but also the most expensive.

None of these are built-in. They're tutorial patterns the developer must construct.

**How Devin does it (Review component):** A dedicated code review agent scans diffs, categorizes issues by severity (red = probable bugs, yellow = warnings, gray = FYI), and operates with full codebase context. Findings are posted as PR comments. The autofix loop then picks up review comments and attempts to resolve them.

**What it catches:** Low-quality completions, incomplete implementations, missing edge cases, logical errors that a reviewer would catch.

**What it misses:** If the critic hallucinates, the error propagates. LLM-as-judge correlation with human judgment is imperfect. The critic can't deterministically verify facts — it can only assess plausibility. A confident-sounding but fabricated claim may pass critic review.

**Cost:** Roughly doubles the LLM cost per action. For an agent making 40 tool calls, adding a critic evaluation to each call doubles the token spend. OpenHands mitigates this by scoring asynchronously and only triggering refinement when the score is low.

### Category 5: Specialized verification model

**Systems:** Devin (SWE-Check)

**Pattern:** A purpose-trained model specialized for bug detection analyzes diffs. Trained with reinforcement learning on real bugs. Runs at inference speed.

**When it runs:** Post-generation, on the diff.

**LLM involved:** Yes, but a specialized small model — not a general-purpose frontier model.

**How Devin does it:** SWE-Check is an RL-trained model that:
- Analyzes code diffs for likely bugs
- Uses tool-calling (can look up definitions, find references) during analysis
- Trained with a reward function optimizing F(beta=0.5), emphasizing precision over recall — it's better to miss some bugs than to flood developers with false positives
- Uses "reward linearization" to translate global F-beta metrics to sample-level rewards for RL training
- Runs on Cerebras inference for near-real-time speed
- Outputs structured bug descriptions with suggested fixes

Performance: matches frontier model accuracy on in-distribution data but lags behind on out-of-distribution evals (F1 delta of 0.29 vs Claude Opus). The trade-off is speed and cost — it runs orders of magnitude faster and cheaper than a frontier model.

**What it catches:** Bugs introduced by code changes, with near-frontier precision on in-distribution data.

**What it misses:** Out-of-distribution bugs, non-code claims, narrative accuracy. SWE-Check verifies *code quality*, not *claim truthfulness*.

**Why it's novel:** This is the only production system using a purpose-trained verification model rather than a general-purpose LLM or deterministic checks. It represents a third path between "use the same LLM again" and "use a linter."

### The missing category: Evidence-level verification

**Systems:** Radar

**Pattern:** Deterministic verification that the agent's narrative claims are grounded in actual tool results. Four layers:

1. *File-read gate:* Check that every cited file was actually read during the run (exists in `state.filesRead`).
2. *Snippet verification:* Re-read the cited file from disk and compare the agent's claimed snippet against real content. Three outcomes: verified (exact match), auto-corrected (close match), rejected (doesn't exist).
3. *Description-evidence coherence:* Extract specific claims from the narrative (package names, version numbers, env var names) and verify they appear somewhere in the evidence snippets.
4. *Post-loop re-verification:* After the agent loop completes, re-check every finding against disk. Remove findings where all evidence failed verification.

**When it runs:** At recording time (layers 1–3) and post-loop (layer 4).

**LLM involved:** No — entirely deterministic.

**What it catches:** Hallucinated file citations, fabricated code snippets, paraphrased snippets that drift from reality (auto-corrected), narrative claims not supported by evidence.

**Prevalence among surveyed production systems: Zero.** No other production LLM-based agent system performs deterministic verification of narrative claims against its own tool results. This is the industry blind spot. (See "Counterarguments and scoping" below for why this claim requires careful framing.)

---

## Why the gap exists

The absence of evidence-level verification across the industry has three explanations:

**1. Most agents produce code, not analysis.** SWE-agent, Aider, Claude Code, Cursor, Devin — they're all primarily *code generation* tools. Their output is a diff, not a narrative. For diffs, the lint-test loop is the natural verification: if the code compiles and tests pass, the output is probably correct. Evidence verification solves a different problem — it verifies *claims about code*, which only matters when the output is analysis, audit, or documentation.

**2. Lint-test alignment with benchmarks.** SWE-bench, the industry's dominant evaluation benchmark, grades agents by running test suites. This creates a natural incentive to build lint-test loops: they directly improve the score. Evidence-level verification would improve *narrative quality*, which SWE-bench doesn't measure and no benchmark currently evaluates.

**3. Evidence verification requires domain structure.** A lint-test loop is generic — it works on any codebase with a test suite. Evidence verification requires structured output (findings with cited evidence), a record of agent actions (which files were read), and domain knowledge about what constitutes a "claim" worth verifying. This makes it harder to build as a framework feature and easier to build as a domain-specific capability.

---

## What production systems actually ship

### Verification comparison

| System | Tool Guards | Lint-Test | LLM Judge | Specialized Model | Evidence Verification |
|--------|:-----------:|:---------:|:---------:|:-----------------:|:---------------------:|
| AutoGPT / BabyAGI | | | | | |
| CrewAI | | | | | |
| OpenCode | partial | | | | |
| SWE-agent | yes | partial | | | |
| Aider | | yes | | | |
| Claude Code | | model-initiated | | | |
| Cursor | | model-initiated | | | |
| Amazon Q Developer | | likely | | | |
| Google Jules | | unknown | | | |
| OpenHands | | | yes | | |
| LangGraph | | | composable | | |
| Devin | | yes (autofix) | yes (Review) | yes (SWE-Check) | |
| **Radar** | | | | | **yes** |

### The verification spectrum

Arranged from cheapest/simplest to most expensive/sophisticated:

```
No verification → Tool guards → Lint-test loop → Evidence verification → LLM-as-judge → Specialized model
     $0              ~$0           ~$0.01/edit       ~$0 (deterministic)    ~2x cost       training cost + inference
```

Evidence verification is notable for being both powerful (catches fabricated claims) and cheap (no LLM calls). It sits in a unique position on the spectrum: more sophisticated than lint-test loops (verifies narrative, not just code) but cheaper than LLM-as-judge (deterministic comparison, not inference).

### Devin: the verification leader

Devin is the only system combining three active verification categories: lint-test loop (autofix from CI signals), LLM-as-judge (Devin Review), and specialized model (SWE-Check). This layered approach is the state of the art for code generation verification.

However, Devin's verification stack is entirely oriented toward *code correctness*. SWE-Check analyzes diffs for bugs. Devin Review catches code quality issues. The autofix loop resolves lint and test failures. None of these verify whether the agent's *descriptions* of code are accurate — because Devin's primary output is code, not analysis.

---

## SWE-bench: how the benchmark shapes verification

SWE-bench is the dominant evaluation benchmark for coding agents, and its methodology has directly shaped what verification systems get built.

**How SWE-bench evaluates:** The agent produces a patch. SWE-bench applies it to the repository inside a Docker container, then runs the repo's test suite. Tests are categorized into:
- **Fail-to-Pass (F2P):** Tests that should start passing after the patch
- **Pass-to-Pass (P2P):** Tests that should remain passing

A patch is "resolved" only if all F2P tests pass AND all P2P tests still pass. Multi-strategy patch application tries `git apply`, then `git apply --reject`, then `patch --fuzz=5`. Each repository has a custom test output parser.

**How this shapes the industry:** Because SWE-bench grades by running tests, agents that run tests during development naturally align with the evaluation criteria. This creates a feedback loop: the benchmark rewards lint-test loops → builders implement lint-test loops → agents improve on the benchmark → the benchmark becomes more influential → more builders implement lint-test loops.

This is productive for code generation quality but creates a blind spot: *narrative quality is unbenched*. No benchmark evaluates whether an agent's description of code is accurate, whether cited evidence is real, or whether findings match actual codebase state. Until a benchmark measures this, the industry has no incentive to build evidence verification.

---

## Academic research

### Reflexion (Shinn et al., 2023)

Self-reflection through linguistic feedback stored in episodic memory. The agent attempts a task, evaluates its own output, generates verbal reflection ("I failed because..."), and uses the reflection as context for the next attempt. Achieves 91% pass@1 on HumanEval (vs. 80% baseline) by learning from compilation and test failures across trials.

**Relevance to evidence verification:** Reflexion improves *performance* through reflection but doesn't verify *factual claims*. The reflection is self-generated — the agent evaluates its own work. This is susceptible to the same hallucination problem: if the agent confidently misrepresents a file's contents, its self-reflection won't catch the error.

### Self-Contrast (Zhang et al., ACL 2024)

Generates diverse solving perspectives, contrasts the differences to surface errors, then creates a checklist for re-examination. Addresses the problem that single self-evaluations are often overconfident — by forcing the model to consider multiple approaches, it's more likely to notice inconsistencies.

**Relevance to evidence verification:** Multi-perspective evaluation could theoretically catch some evidence fabrication (one perspective might notice the snippet doesn't match), but it's probabilistic, not deterministic. A fabricated snippet that's internally consistent would pass all perspectives.

### Language Agent Tree Search / LATS (Zhou et al., 2023)

Combines self-reflection with Monte Carlo tree search and external environment feedback. Explores multiple solution trajectories, scores via reflection, uses UCB (Upper Confidence Bound) for balancing exploration vs. exploitation.

**Relevance to evidence verification:** LATS uses *external environment feedback* (test results, execution output) as part of its scoring — the closest academic work to evidence grounding. But the feedback is "did the code work?" not "does the claim match the evidence?"

### SWE-Check (Cognition / Applied Compute, 2026)

An RL-trained specialized model for bug detection. Key technical contribution: "reward linearization" — translating a global F-beta metric into sample-level rewards suitable for RL training. Trained to optimize F(beta=0.5), emphasizing precision over recall.

**Relevance to evidence verification:** SWE-Check demonstrates that specialized, trained verifiers can match frontier model accuracy at a fraction of the cost. The principle is transferable: a small model trained specifically to compare evidence snippets against source files could potentially achieve high accuracy on evidence verification tasks. This is a potential future direction — training a verifier rather than using deterministic string comparison.

### "A Rubric-Supervised Critic" (Wang et al., 2026)

The OpenHands critic model paper. Trains evaluators on real-world outcomes using rubric-supervised approaches. The key insight: critics trained on binary outcomes (pass/fail) underperform critics trained on rubric-decomposed outcomes (the rubric breaks the evaluation into checkable sub-criteria).

**Relevance to evidence verification:** Rubric decomposition maps naturally to evidence verification: "Was the file actually read?", "Does the snippet match?", "Does the description match the snippet?" These are the sub-criteria. A rubric-supervised critic could potentially learn to check these, though deterministic verification is cheaper and more reliable for this specific task.

---

## Design considerations for evidence verification

### When evidence verification matters

Evidence verification is most valuable when:

1. **The output is analysis, not code.** If the agent produces findings, assessments, documentation, or recommendations, evidence verification catches fabrication that lint-test loops can't.

2. **The agent reads untrusted content.** If the agent analyzes external codebases (not the developer's own code), the developer can't easily spot fabricated claims by inspection. They're trusting the agent's report.

3. **The output is consumed by non-technical stakeholders.** A developer might notice that a cited file doesn't contain the claimed code. A project manager reading an audit report won't.

4. **Findings have downstream consequences.** If audit findings trigger remediation work, migration planning, or security reviews, fabricated findings waste real resources.

### The auto-correction trade-off

A strict verification system rejects evidence that doesn't exactly match the source file. But LLMs routinely paraphrase, truncate, or reformat code snippets. A snippet that's "close but not exact" is usually directionally correct — the LLM saw the right code but reproduced it imprecisely.

Three approaches:

**Strict rejection:** Reject any snippet that doesn't exactly match. *Problem:* Discards too much. The LLM's evidence is often ~90% accurate, and rejecting it forces the system to produce findings with no evidence or to re-try (expensive).

**Lenient acceptance:** Accept any snippet as long as the file exists. *Problem:* Allows fabricated snippets for files that happen to exist. The LLM might cite the right file but invent the code inside it.

**Auto-correction:** Compare the claimed snippet against the actual file. If it's close (fuzzy match), replace it with the real code and note the correction. If it's not close, reject it. *Trade-off:* This is the pragmatic middle ground. It preserves the LLM's intent (it found the right area of the code) while ensuring the output contains real code. The risk is that auto-correction might change the semantic meaning — the corrected snippet might not support the original claim.

Radar uses auto-correction (`verifyAndCorrectEvidence` in `src/tools/analysis/verifyEvidence.ts`). The implementation re-reads the file, searches for the snippet (or the closest match), and replaces the claimed snippet with the actual code. If no reasonable match is found, the evidence item is rejected.

### The file-read gate: cheapest and most effective

The most impactful single verification check is the simplest: was the cited file actually read during the run?

This catches the most common LLM hallucination pattern: confidently citing a plausible-sounding file that was never examined. The check is a set membership test (`state.filesRead.has(normalizedPath)`) — essentially free, and it prevents an entire class of fabrication.

No surveyed system other than Radar implements this check. In systems where the model "decides" to verify its work (Claude Code, Cursor), there's no enforcement that the cited file was actually read — the model could claim to have examined a file based on its training data.

### Description-evidence coherence: the subtle layer

The most sophisticated check is also the most novel: extracting specific claims from the narrative and verifying they appear in evidence.

If a finding says "the project uses `@sitecore-jss/sitecore-jss-nextjs` version 21.1.0" but no evidence snippet contains `@sitecore-jss/sitecore-jss-nextjs` or `21.1.0`, the finding is flagged. The claim may be true (the package is in the project), but it's not *supported by the evidence the agent cited*.

This catches a subtle hallucination pattern: the agent reads a file, extracts some evidence, then writes a description that goes beyond what the evidence actually shows. The evidence is real, but the narrative drifts. Without coherence checking, these drift-hallucinations are invisible — the evidence passes verification, but the conclusion doesn't follow from it.

### Post-loop re-verification: catching temporal drift

Evidence that was valid at recording time may become invalid later in the run if the agent continues reading files and the context changes. The post-loop pass re-reads every cited file from disk and re-checks every snippet. Findings where all evidence items fail re-verification are removed entirely.

This is a safety net, not a primary mechanism. In practice, most findings that pass recording-time verification also pass post-loop verification. But the edge cases it catches (file re-read with different results, evidence recorded before context compression evicted the original data) justify the minimal cost.

---

## Counterarguments and scoping

The claim that evidence-level verification is absent from other production systems requires careful framing. Three counterarguments deserve direct responses.

### "SAST tools verify their claims — findings ARE the evidence"

Traditional static analysis tools (SonarQube, Semgrep, CodeQL, Checkmarx) produce findings grounded in AST parsing. The tool parsed the actual code and reports what it found. The finding IS the evidence — there is no gap between "what the tool saw" and "what the tool claims."

This is the strongest objection. A dev in the audience can reasonably say "SonarQube's findings are verified by construction."

**Why this is a different problem:** SAST tools never had a narrative-generation step that can hallucinate. There is no LLM in the loop producing prose claims that might diverge from the underlying data. Evidence verification exists precisely because an LLM generates narrative, and that narrative can drift from reality. SAST tools never needed this because their output is the deterministic analysis itself.

**The hybrid case — Semgrep Multimodal.** Semgrep Multimodal layers an LLM on top of traditional SAST to explain findings in natural language — connecting the rule's message to the code that triggered it. The underlying finding is AST-grounded, and the AI layer summarizes it. But Semgrep does not verify that the AI-generated explanation accurately represents the AST finding. If the LLM says "this SQL injection happens because user input flows through `sanitize()` which doesn't escape quotes" but the actual data flow doesn't involve `sanitize()`, nothing catches this.

Swimm makes similar marketing claims ("Deterministic understanding. No black boxes.") but also layers AI summarization on deterministic analysis without verifying the AI output.

These hybrid systems demonstrate the exact gap evidence verification addresses: a deterministic analysis produces ground truth, an LLM summarizes it, and nothing checks whether the summary is faithful. Evidence verification is the missing check.

### "Google's SAFE verifies narrative claims against evidence"

SAFE (Search-Augmented Factuality Evaluator, Wei et al., NeurIPS 2024, arXiv 2403.18802) decomposes LLM responses into individual atomic facts and evaluates each using multi-step LLM reasoning over Google Search results. It achieves 72% agreement with human annotators, winning 76% of disagreements. 20x cheaper than human evaluation.

SAFE is the closest academic work to evidence verification, and the architectural pattern (decompose → verify each claim) is directly transferable. Two differences:

1. **Non-deterministic.** SAFE uses LLM reasoning to judge whether search results support a claim. This is Category 4 (LLM-as-judge), not deterministic verification. A confident-sounding but fabricated claim may pass if the LLM misjudges the search results.

2. **Different evidence source.** SAFE verifies against web search results, not against the agent's own tool call history and the actual filesystem. For a codebase analysis agent, the evidence source is "the files this agent actually read" — a much narrower and more verifiable source than the open web.

The same distinction applies to FacTool (Chern et al., 2023, arXiv 2307.13528) and FActScore (Min et al., EMNLP 2023, arXiv 2305.14251), which use similar decompose-and-verify patterns against web search or Wikipedia. FacTool's code domain verification is execution-based (does the code run correctly?), which is the lint-test category, not claim verification.

All three are research prototypes, not production systems. The architectural pattern is validated, but none target codebase analysis or agentic tool results.

### "EviBound already solves this for research agents"

EviBound (Chen, 2025, arXiv 2511.05524) is the closest to Radar's approach. It addresses LLM agents reporting false claims — tasks marked "complete" despite missing artifacts, contradictory metrics, failed executions. Dual governance gates: a pre-execution Approval Gate validates criteria schemas, and a post-execution Verification Gate validates artifacts via API queries.

Results: baseline (prompt-only) 100% hallucination rate → verification-only 25% → EviBound (dual gates) 0%. Only ~8.3% execution overhead.

**Why this is different:** EviBound verifies task completion claims against artifacts (MLflow run logs, model registries). It asks "did the agent actually do what it claims to have done?" Radar's evidence verification asks a different question: "does the agent's narrative description of code match the actual code it read?" EviBound's artifacts are structured API responses with programmatic verification. Radar's artifacts are source code files where verification requires fuzzy string matching, snippet comparison, and claim extraction from prose.

The dual-gate pattern (validate intent before execution, verify claims after) is shared. EviBound validates this architecture at 0% hallucination rate. The principles generalize even though the domains and verification mechanisms differ.

---

## Recent academic research on agent hallucination

The broader problem of agentic hallucination is now a recognized research area. Several recent papers validate the severity of the problem and the insufficiency of current approaches.

### AgentHallu (Liu et al., 2026, arXiv 2601.06818)

The first benchmark specifically for hallucination attribution in LLM-based agents. 693 trajectories across 7 agent frameworks, 5 domains. Hallucination taxonomy includes Planning, Retrieval, Reasoning, Human-Interaction, and Tool-Use (14 sub-categories).

Key finding: **the best model (GPT-5, Gemini-2.5-Pro) achieves only 41.1% step localization accuracy, and tool-use hallucinations are the hardest category at 11.6%.** Even frontier models cannot reliably detect when an agent misrepresents its own tool results. This validates that deterministic verification is necessary — you cannot rely on the model (or another model) to catch these errors.

### Spectral Guardrails (Noel, 2026, arXiv 2602.08082)

Detects tool-use hallucinations by analyzing the spectral topology of attention patterns. Achieves 97.7% recall on Llama 3.1 8B. Discovers that hallucination is a "thermodynamic state change" in attention patterns — attention becomes noise-like when the model hallucinates.

Requires access to model internals (attention weights), making it unusable with API-only models (Bedrock, OpenAI API). Relevant as a future direction if open-weight models become standard for agent deployment.

### TraceSafe-Bench (Chen et al., 2026, arXiv 2604.07223)

First benchmark for mid-trajectory safety in multi-step tool-use. 12 risk categories including hallucinations. Evaluates 13 LLM-as-guard models and 7 specialized guardrails.

Key finding: **guardrail efficacy is driven more by structural data competence (JSON parsing) than semantic safety alignment.** Architecture matters more than model size for catching agentic hallucination. This supports the case for deterministic verification: structural checks (does this file exist? does this snippet match?) outperform semantic reasoning about whether a claim "seems right."

### RARR (Gao et al., ACL 2023, arXiv 2210.08726)

"Researching and Revising What Language Models Say, Using Language Models." A post-hoc system that (1) finds attribution for generated text by searching for supporting sources, and (2) post-edits the output to fix unsupported content while preserving the original.

Most relevant architectural contribution: RARR doesn't just detect errors — it *fixes* them. This maps to Radar's auto-correction pattern, where fabricated snippets are replaced with real code rather than simply rejected. The research-then-revise architecture validates auto-correction as a design choice.

### VeriCite (Qian et al., SIGIR-AP 2025, arXiv 2510.11394)

Three-stage framework for verifying citations in RAG outputs: initial answer generation with NLI verification, supporting evidence selection, final answer refinement. Directly addresses "did the citation actually support the claim" — the same question Radar's description-evidence coherence check answers, applied to RAG instead of agent tool results.

---

## Key takeaways

1. **The industry verifies code, not claims.** The lint-test loop is the dominant pattern because it aligns with SWE-bench and catches the most impactful errors in code generation. But for agents that produce analysis, audit, or documentation, code verification is insufficient.

2. **Evidence verification is cheap and unclaimed in production.** It requires no LLM calls, no specialized models, no training data. It's a set membership test (file-read gate), a string comparison (snippet verification), and a regex extraction (coherence check). Despite this low cost, no surveyed production LLM-based agent system implements it. Academic prototypes (SAFE, FacTool, EviBound) validate the architecture but target different domains.

3. **The file-read gate alone catches the most common hallucination.** Checking whether the cited file was actually read during the run is the single highest-value verification check. It's essentially free and prevents confident-sounding fabrications about files the agent never examined.

4. **Auto-correction is more practical than strict rejection.** LLMs reproduce code snippets imprecisely. Replacing the claimed snippet with the actual code (when a close match exists) preserves the agent's intent while ensuring the output contains real code. RARR validates this "revise rather than reject" approach.

5. **No benchmark measures narrative accuracy.** SWE-bench measures code correctness via test suites. AgentHallu measures hallucination detection but not prevention. No benchmark evaluates whether agent-generated analysis accurately describes the codebase. This is the structural reason the industry hasn't invested in evidence verification.

6. **Tool-use hallucination is the hardest category.** AgentHallu shows frontier models achieve only 11.6% accuracy at detecting tool-use hallucinations. Deterministic verification (file-read gate, snippet comparison) sidesteps the detection problem entirely — it doesn't need to "detect" hallucination, it verifies the claim against the source.

6. **Verification approaches are complementary.** Lint-test loops, evidence verification, and LLM-as-judge catch different failure modes. The ideal system layers them: lint-test for code correctness, evidence verification for claim grounding, LLM judge for holistic quality. Devin comes closest to this (minus evidence verification); Radar occupies the evidence niche that Devin doesn't.

---

## References

### Production systems
- Yang, J. et al. (2024). "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering." arXiv:2405.15793.
- Cognition AI (2026). "SWE-Check: 10x Faster Bug Detection." cognition.ai/blog/swe-check-10x-faster.
- Cognition AI (2026). "Closing the Agent Loop." cognition.ai/blog/closing-the-agent-loop-devin-autofixes-review-comments.
- SWE-bench. github.com/princeton-nlp/SWE-bench, `swebench/harness/grading.py`.
- Anthropic. "How Claude Code Works." code.claude.com/docs/en/how-claude-code-works.md.
- Aider. "Linting and Testing." aider.chat/docs/usage/lint-test.html.
- OpenHands. "Critic Guide." docs.openhands.dev/sdk/guides/critic.md.
- LangChain. "Reflection Agents." langchain.com/blog/reflection-agents.

### Verification and factuality
- Wei, J. et al. (2024). "Long-form factuality in large language models." NeurIPS 2024. arXiv:2403.18802. (SAFE)
- Chern, I-C. et al. (2023). "FacTool: Factuality Detection in Generative AI." arXiv:2307.13528.
- Min, S. et al. (2023). "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation." EMNLP 2023. arXiv:2305.14251.
- Gao, L. et al. (2023). "RARR: Researching and Revising What Language Models Say, Using Language Models." ACL 2023. arXiv:2210.08726.
- Chen, Y. (2025). "Evidence-Bound Autonomous Research (EviBound)." arXiv:2511.05524.
- Qian, H. et al. (2025). "VeriCite: Verifying Citations in RAG Outputs." SIGIR-AP 2025. arXiv:2510.11394.

### Agent hallucination
- Liu, Y. et al. (2026). "AgentHallu: Hallucination Attribution in LLM-based Agents." arXiv:2601.06818.
- Noel, R. (2026). "Spectral Guardrails: Training-Free Detection of Tool-Use Hallucinations." arXiv:2602.08082.
- Chen, X. et al. (2026). "TraceSafe-Bench: Mid-Trajectory Safety in Multi-Step Tool-Use." arXiv:2604.07223.
- Healy, D. et al. (2026). "Internal Representations for Tool Selection Hallucination Detection." arXiv:2601.05214.

### Reflection and reasoning
- Shinn, N. et al. (2023). "Reflexion: Language Agents with Verbal Reinforcement Learning." arXiv:2303.11366.
- Zhang, W. et al. (2024). "Self-Contrast: Better Reflection Through Inconsistent Solving Perspectives." ACL 2024.
- Zhou, A. et al. (2023). "Language Agent Tree Search Unifies Reasoning Acting and Planning in Language Models." arXiv:2310.04406.
- Wang, X. et al. (2026). "A Rubric-Supervised Critic from Sparse Real-World Outcomes." arXiv:2603.03800.
