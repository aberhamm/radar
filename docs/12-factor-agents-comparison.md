# 12-Factor Agents vs. repo-audit-delivery-agent

Research comparison of the [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) principles (by HumanLayer) against our architecture. Identifies alignment, gaps, and opportunities.

## Background

12-Factor Agents is a set of principles for building production-ready LLM-powered software, inspired by the original 12-Factor App methodology. Core thesis: most agent frameworks struggle beyond 80% quality for customer-facing features, so the fastest path to good AI software is taking small, modular agent-building concepts and incorporating them into existing products.

22.4k stars, actively maintained.

---

## Factor-by-Factor Assessment

### Factor 1: Natural Language → Tool Calls — Grade: A

**Principle:** LLM converts natural language intent into structured tool calls; deterministic code executes them.

**Our implementation:** Pi's `Agent` class handles this natively. The agent receives a goal prompt in natural language and decides which of 29 tools to call. `piToolAdapter.ts` routes structured outputs to pure-function tool implementations. Input normalization (`normalizePathArgs`) and validation (`validators.ts`) sit between the LLM's output and execution — exactly as prescribed.

**Gap:** None.

---

### Factor 2: Own Your Prompts — Grade: A

**Principle:** Never delegate prompt engineering to opaque frameworks. Treat prompts as testable code you control. Anti-pattern: `Agent(role="...", personality="...")` abstractions that hide what tokens reach the model.

**Our implementation:** Multi-layer prompt system with full transparency:

- `src/rules/*.md` — consulting rules in plain English markdown
- `goalPrompts.ts` — 10 goal-specific templates
- `systemPrompt.ts` — explicit assembly with LRU cache
- `contextBoundary.ts` — injection defense we control

No magic abstractions. Every token that reaches the model is traceable to a specific file.

**Gap:** None.

---

### Factor 3: Own Your Context Window — Grade: A+

**Principle:** Craft custom context structures; don't rely on standard message arrays. Use event-based thread models. Custom formats beat standard chat arrays for token efficiency.

**Our implementation:** Goes beyond the recommendation with an active compression engine:

- **Context compression** (`contextCompression.ts`): evidence pinning, stale-read collapsing, observation eviction — three tiers applied before every LLM call
- **Pre-computed context**: deterministic tool results injected before agent loop starts (saves 3-5 round-trips)
- **Budget-aware compression**: tighter window after model switch (12 → 8 messages)
- Reduces ~200K tokens to ~30K while preserving evidence integrity

The 12-factor guide suggests custom formats; we've built an active compression engine that dynamically manages context quality.

**Gap:** None — exceeds the principle.

---

### Factor 4: Tools Are Just Structured Outputs — Grade: A

**Principle:** Tools are structured output from the LLM that triggers deterministic code. You own the execution layer. "Just because an LLM called a tool doesn't mean you have to execute a specific corresponding function the same way every time."

**Our implementation:** Exact match:

- Tools are pure functions — no LLM calls inside, no reasoning, no side effects beyond file reads
- `makeTool()` wraps execution with validation, boundary markers, and result formatting
- `switch_to_fast_model` is a perfect example of a "signal tool" — structured output that doesn't map to traditional execution
- File dedup (`isFileUnchanged`) gates execution transparently without the LLM knowing
- `beforeToolCall` hook can intercept, modify, or reject any tool execution

**Gap:** None.

---

### Factor 5: Unify Execution State and Business State — Grade: A-

**Principle:** Don't maintain separate tracking systems for execution state (current step, retry counts) and business state (findings, tool results). Consolidate into a unified event-based model.

**Our implementation:** `AgentState` is the single source of truth:

- `findings[]` = business state (investigation results)
- `toolCallCount`, `filesRead`, `investigationLog` = execution state
- Both live in the same serializable object
- Checkpoint persistence saves and restores both together
- Dashboard, CLI, and tests all read from the same state shape

**Minor gap:** `AgentLoopContext` holds transient loop state (streaming, telemetry) separately from `AgentState`. This is deliberate — loop mechanics don't need persistence — but it's technically a state split. The guide would say collapse it into the thread.

---

### Factor 6: Launch/Pause/Resume with Simple APIs — Grade: B

**Principle:** Simple APIs to launch, pause between tool selection and execution, and resume from external triggers (webhooks) without deep orchestrator coupling.

**Our implementation:**

| Capability | Status |
|------------|--------|
| Launch via CLI | ✅ `radar analyze --repo <path>` |
| Launch via API | ✅ POST /api/run |
| Launch via CI | ✅ Auto-detects GitHub Actions / Azure DevOps |
| Pause at budget gate | ✅ 80% budget → waits for user decision |
| Resume from checkpoint | ✅ JSONL persistence, hydrate state, continue |
| Durable pause/resume (survive restart) | ❌ |
| Resume from external webhook | ❌ |

**Gap:** Budget extension gate uses in-process Promise resolution. If the server restarts, pause state is lost. True durable pause/resume would require persisting the pending tool call + thread state and resuming from checkpoint with the decision already made. Not critical for our use case (runs complete in 2-5 minutes) but would be needed for longer-running investigations.

---

### Factor 7: Contact Humans with Tool Calls — Grade: D

**Principle:** Define explicit `RequestHumanInput` tools with intent, question, context, urgency. Human interaction is a first-class primitive, not a binary choice between text and structured data.

**Recommended pattern:**
```typescript
class RequestHumanInput {
  intent: "request_human_input"
  question: string
  context: string
  options: { urgency: "high" | "medium" | "low", response_format: "free_text" | "yes_no" | "multiple_choice" }
}
```

**Our implementation:** The agent has no `ask_human` or `request_clarification` tool. Human interaction is limited to:

- Budget extension gate (implicit pause, not agent-initiated)
- Steering messages (system → agent, one-directional)
- Dashboard shows live progress but doesn't accept mid-run human input beyond "extend/finish"

The agent cannot say "I found something ambiguous — should I investigate path A or B?" It just picks.

**This is the biggest architectural gap.** For consulting work, the ability to ask "Is this a known intentional pattern?" or "Should I investigate the legacy modules or focus on the new architecture?" would significantly improve output quality and client trust.

**Opportunity:** Add a `request_clarification` tool that:
1. Pauses the loop
2. Surfaces the question in the dashboard with structured options
3. Resumes with the human's answer injected into context
4. Falls back to "best guess + flag uncertainty" in CI mode (no human available)

---

### Factor 8: Own Your Control Flow — Grade: A

**Principle:** Build custom control structures. Enable granular interruption between tool selection and invocation. Distinguish sync steps (continue immediately) from async steps (pause and resume).

**Our implementation:**

- `beforeToolCall` hook: budget enforcement, recording gate, sub-budget checks — runs between LLM decision and tool execution
- `afterToolCall` hook: steering messages, model switch detection, compression triggers
- Retry nudges: custom control flow for output assembly
- `autoAssembleFromFindings()`: deterministic fallback if LLM fails to cooperate
- Three-intent model maps cleanly: sync tools (read_file), agent-managed async (switch_to_fast_model), and gated (budget extension)

Pi provides the loop; we control what happens at each decision point.

**Gap:** None.

---

### Factor 9: Compact Errors into Context Window — Grade: A-

**Principle:** Append formatted errors to the event thread; LLM self-heals. Cap consecutive failures at ~3. Escalate when stuck.

**Our implementation:**

- Tool validation errors return as tool results (LLM sees them, adjusts next call)
- API errors handled by `withRetry()` with exponential backoff (transparent to agent)
- Repeated call detection in `AgentLoopContext` flags when agent is looping
- Steering messages escalate ("You MUST call assemble_output NOW")
- Final fallback: auto-assembly if agent never recovers

**Minor gap:** No explicit consecutive-failure cap at N=3 per the guide's recommendation. The budget acts as an implicit cap, but a dedicated "you've failed this tool 3 times, move on" mechanism could prevent wasted budget on intractable operations.

---

### Factor 10: Small, Focused Agents — Grade: A

**Principle:** Build agents with narrow responsibilities (3-10 steps, max 20). As context grows, LLMs lose focus.

**Our implementation:**

- Default budget: 45 tool calls (above "max 20" but justified for deep investigation)
- Tiered multi-pass: core pass (80% budget) + specialist passes (10% each) — each pass is a focused agent with its own goal prompt and tool budget
- `ci-check` goal: 15 tool calls max — deliberately small for fast PR feedback
- Dual-model split: investigation agent (Sonnet) hands off to writing agent (Haiku) — two focused phases
- Each specialist pass (nextjs, accessibility, security) runs with its own rules file and constrained scope

The multi-pass architecture is exactly "small focused agents composed into a larger system."

**Gap:** The core investigation pass at 45 calls can still be broad. The guide would suggest breaking it into sub-agents (e.g., "dependency auditor" + "config auditor" + "code quality auditor"). Our approach works because the consulting domain rewards holistic investigation over narrow focus.

---

### Factor 11: Trigger from Anywhere — Grade: B-

**Principle:** Hub-and-spoke. Enable triggering and response across multiple communication channels. Support non-human triggers with human oversight for critical decisions.

**Our implementation:**

| Channel | Trigger | Response |
|---------|---------|----------|
| CLI | ✅ | ✅ (stdout, files) |
| Dashboard API | ✅ | ✅ (SSE stream, rendered UI) |
| GitHub Actions | ✅ | ✅ (PR comment, annotations, SARIF, labels) |
| Azure DevOps | ✅ | ✅ (PR comment) |
| Webhook (outbound) | ✅ | ✅ (POST results to endpoint) |
| Slack | ❌ | ❌ |
| Email | ❌ | ❌ |

**Gap:** No inbound triggers from chat platforms. For our consulting use case, a Slack integration ("@radar scan this repo") would reduce friction for non-technical stakeholders. Not critical for v1 but valuable for platform adoption.

---

### Factor 12: Make Your Agent a Stateless Reducer — Grade: A

**Principle:** Treat the agent as a pure functional reducer. Given the same input (thread of events), produce the same output (next action). The agent is a `foldl` over events.

**Our implementation:**

- `runAgent()` is a pure function: inputs (repo path, goal, budget, state) → outputs (RunResult)
- All state is explicit in `AgentState` — no hidden closures or ambient state
- Checkpoint resume works because you can reconstruct the agent from serialized state
- Context compression is deterministic given the same message history
- `autoAssembleFromFindings()` is a pure function over accumulated state

**Nuance:** LLM non-determinism means the same thread won't produce *identical* outputs across runs. But architecturally, the agent is stateless — it only knows what's in its context window. No hidden memory, no ambient state, no side-channel information.

**Gap:** None.

---

### Factor 13 (Bonus): Pre-fetch Context — Grade: A

**Principle:** If there's a high probability the model will call tool X, don't waste round-trips. Call it deterministically and include results in context. Remove it from the available tool set.

**Our implementation:** `preCompute.ts` does exactly this:

- `detectAppRoots()` — always needed, run before loop
- `parsePackageJson()` — always needed for dependency analysis
- `listDirectory()` — always the first thing an agent does
- Results injected as "PRE-COMPUTED CONTEXT" section in the goal prompt

Saves 3-5 LLM round-trips per run. Textbook implementation.

**Gap:** Could go further — e.g., pre-fetching `tsconfig.json` contents, CI config files, or common framework config files that the agent almost always reads.

---

## Summary Scorecard

| Factor | Grade | Status |
|--------|-------|--------|
| 1. NL → Tool Calls | A | ✅ Aligned |
| 2. Own Your Prompts | A | ✅ Aligned |
| 3. Own Your Context Window | A+ | ✅ Exceeds |
| 4. Tools = Structured Outputs | A | ✅ Aligned |
| 5. Unified State | A- | ✅ Aligned (minor split by design) |
| 6. Launch/Pause/Resume | B | ⚠️ No durable pause across restarts |
| 7. Contact Humans via Tools | D | ❌ Biggest gap |
| 8. Own Your Control Flow | A | ✅ Aligned |
| 9. Compact Errors | A- | ✅ Aligned (no explicit cap) |
| 10. Small Focused Agents | A | ✅ Multi-pass architecture |
| 11. Trigger from Anywhere | B- | ⚠️ No chat/email channels |
| 12. Stateless Reducer | A | ✅ Aligned |
| 13. Pre-fetch Context | A | ✅ Aligned |

**Overall: 10/12 factors strong. 2 partial gaps. 1 significant opportunity.**

---

## Key Opportunities

### High Impact: Human-in-the-Loop Tool (Factor 7)

Add a `request_clarification` tool that enables agent-initiated human contact:

```typescript
// Tool definition
{
  name: "request_clarification",
  description: "Ask the human a question when you encounter ambiguity that would significantly affect findings quality",
  parameters: {
    question: string,        // What you need to know
    context: string,         // Why it matters for the investigation
    options?: string[],      // Suggested answers (optional)
    urgency: "blocking" | "nice_to_have"
  }
}
```

**Behavior by trigger context:**
- **Dashboard:** Pause loop, show question in UI, wait for response, inject answer into context
- **CI:** Skip (use best guess + flag uncertainty in findings)
- **CLI:** Print question to stdout, read stdin (or skip with `--no-interact`)

### Medium Impact: Consecutive Error Cap (Factor 9)

Add a 3-strike rule per tool:

```typescript
// In beforeToolCall hook
if (consecutiveFailures[toolName] >= 3) {
  inject steering: "Tool ${toolName} has failed 3 times. Move on to a different approach."
  return { skip: true }
}
```

### Low Impact: Pre-fetch Expansion (Factor 13)

Pre-fetch additional high-probability reads:
- `tsconfig.json` / `tsconfig.*.json`
- `.github/workflows/*.yml` (CI config)
- `next.config.*` / `nuxt.config.*` (framework config)
- `.env.example` (environment shape)

---

## Architectural Alignment

The 12-factor principles validate several non-obvious architectural decisions we made:

1. **Tools are deterministic** (Factor 4) — The spec's #1 principle ("tools return facts, never call an LLM") is exactly Factor 4's recommendation.

2. **Dual-model pattern** (Factor 10) — The investigate-then-write split is a specific instantiation of "small focused agents."

3. **Pre-compute phase** (Factor 13) — `preCompute.ts` independently arrived at the same optimization the guide recommends as a bonus factor.

4. **Context compression** (Factor 3) — Our three-tier compression goes significantly beyond what the guide suggests, but aligns with its core thesis that context engineering is the highest-leverage investment.

5. **Budget enforcement via hooks** (Factor 8) — `beforeToolCall`/`afterToolCall` implement the guide's "granular interruption between tool selection and execution" pattern.

---

## References

- [12-Factor Agents repo](https://github.com/humanlayer/12-factor-agents) — HumanLayer, 22.4k stars
- [Original 12-Factor App](https://12factor.net/) — Heroku, the inspiration
- `docs/code-walkthrough.md` — Our architecture documentation
- `src/runner/runner.ts` — Core orchestration implementation
- `src/runner/contextCompression.ts` — Context management implementation
- `src/runner/agentLoopContext.ts` — Hook-based control flow
