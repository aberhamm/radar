# Context Management & Truncation in Agentic Systems

A technical reference on how LLM-based agent loops manage tool results and conversation history as context grows. Covers the full taxonomy of approaches, what production systems actually ship, and the tradeoffs of each.

## The problem

An agentic loop accumulates context with every turn: system prompt + tool definitions + conversation history + tool results. A 45-tool-call investigation can easily produce 200K+ tokens of raw tool output. Even models with large context windows (200K for Claude, 1M for Gemini) face three pressures:

1. **Cost** — input tokens are priced per-token. At $3/MTok (Sonnet), 200K tokens of accumulated tool results costs $0.60 per turn by the end of a run.
2. **Quality** — "Lost in the Middle" (Liu et al., 2023) showed LLMs attend strongly to the beginning and end of context but poorly to the middle. Stuffing 200K tokens of tool results degrades reasoning even when it fits.
3. **Latency** — more input tokens = slower time-to-first-token. Each turn gets progressively slower.

Every agent framework must decide: what stays in context, what gets compressed, and what gets dropped.

---

## Two truncation points

In a typical agentic loop, truncation happens at two distinct stages:

### Stage 1: Per-tool result truncation

When a tool returns its result, the framework may truncate it *before* it enters the conversation history. This is the first line of defense.

**When it happens:** Immediately after tool execution, before the result is added to the message array.

**What it controls:** The maximum size of any single tool result.

**Why it exists:** A single `grep` or `read_file` can return megabytes. Without per-tool limits, one tool call can consume the entire context window.

### Stage 2: Conversation history compression

Before each LLM call, the framework may compress the accumulated conversation history — rewriting, summarizing, or evicting older messages.

**When it happens:** Before every LLM API call, applied to the full message array.

**What it controls:** The total size of all accumulated messages.

**Why it exists:** Even with per-tool limits, 40+ tool results accumulate. The conversation grows monotonically without history management.

Both stages are necessary. Stage 1 prevents any single result from being catastrophically large. Stage 2 manages the aggregate growth over many turns.

### Shared middleware vs. per-tool strategies

A critical design decision is *where* truncation logic lives:

**Shared middleware** — one function truncates all tool results the same way, with only the size limit varying per tool. This is simpler to implement but treats grep results, file reads, and directory listings identically. A grep result gets the same character slice as a file read, even though grep results are discrete matches (droppable cleanly) while file reads are continuous text (sliceable at line boundaries).

**Per-tool strategies** — each tool owns its truncation and uses a strategy suited to its content type. Grep drops complete matches. File reads truncate at line boundaries and offer pagination hints. Bash uses middle-cut. The shared layer becomes a safety net that rarely fires.

Production systems that handle this well (OpenCode, SWE-agent, Claude Code) all use per-tool strategies. This project now follows the same pattern — each tool owns its truncation, with a structure-aware shared layer as a safety net.

| Tool type | Content structure | Best truncation strategy |
|-----------|-------------------|------------------------|
| File read | Sequential lines | Line-boundary truncation + pagination |
| Grep/search | Discrete matches | Drop complete matches beyond limit |
| Command output | Header → bulk → result | Middle-cut (keep head + tail) |
| Directory listing | Discrete entries | Drop entries beyond limit |
| JSON/API response | Nested objects | Object-boundary truncation |

---

## Stage 1: Per-tool result truncation methods

### 1.1 Fixed character/line slicing

Slice the result string at a hard character or line limit.

```
result = result.slice(0, MAX_CHARS)
```

**Who uses it:**
- Many custom agents as a baseline
- Continue.dev uses per-tool char/line limits (bash: 50K chars / 1K lines; file read: 100K chars / 5K lines) but the truncation itself is still a raw slice at the limit boundary
- repo-audit-delivery-agent (this project, pre-upgrade): `spillAndTruncate` applied `text.slice(0, limit)` to all tools uniformly. Now superseded — see "Our implementation" section

**Strengths:**
- Zero overhead — no parsing, no computation
- Predictable output size
- Easy to implement and reason about

**Weaknesses:**
- Breaks structure — slices mid-JSON, mid-line, mid-match
- No awareness of content importance
- The LLM may see garbled data at the boundary
- Always keeps the head, which isn't always where the important content is

> **Note:** OpenCode's per-line truncation (2000 chars, raw byte slice + `"..."`) falls in this category, but its file-level handling does not — see "Rejection with guidance" and "Pre-truncation via tool design" below.

### 1.2 Structural boundary truncation

Truncate at natural boundaries: complete lines, complete JSON objects, complete grep matches.

```
// Instead of slicing at char 20,000:
// Drop the last incomplete match and keep N complete matches
matches = matches.slice(0, MAX_MATCHES)
```

**Who uses it:**
- OpenCode grep: drops complete matches beyond 100 (not partial)
- SWE-agent: 100-line file viewing window at line boundaries
- Claude Code grep: `head_limit` param drops complete entries

**Strengths:**
- LLM always sees valid, parseable results
- No garbled partial data
- Minimal overhead (just needs to know the structure)

**Weaknesses:**
- Still position-biased (keeps first N, drops last N)
- No semantic awareness — the 101st grep match might be the critical one
- Requires per-tool implementation (grep truncation differs from file truncation)

### 1.3 Head + tail (middle-cut)

Keep the beginning and end of the result, drop the middle.

```
first = result.slice(0, HALF)
last = result.slice(-HALF)
result = first + "\n...[N lines elided]...\n" + last
```

**Who uses it:**
- OpenHands: first 15K + last 15K chars for bash output (MAX_CMD_OUTPUT_SIZE = 30,000)
- SWE-agent: observation truncation when exceeding `max_observation_length` (default 100K chars)

**Strengths:**
- Preserves both the setup/headers (beginning) and the outcome/errors (end)
- Good for command output where the middle is repetitive (build logs, test runs)
- LLM sees both the "what" and the "result"

**Weaknesses:**
- Bad for source code — the middle IS the content (functions, logic, business rules)
- Bad for grep results — middle matches may be the most relevant
- The cut point is arbitrary and may split semantic units
- Only appropriate for sequential/log-style output

### 1.4 Tail-biased truncation

Keep the last N lines/chars instead of the first N.

```
result = result.slice(-MAX_CHARS)
```

**Who uses it:**
- Continue.dev: keeps last N lines/chars for command output (bash: last 1K lines)

**Strengths:**
- For build/test output, the end contains the verdict (pass/fail, error message)
- Simple to implement

**Weaknesses:**
- Loses the beginning, which often contains the command, headers, or setup context
- Bad for file reads (the end of a file isn't inherently more important)
- The LLM may not understand what produced the output without the header

### 1.5 Pre-truncation via tool design (pagination)

Instead of truncating results, design tools with built-in pagination so the agent requests only what it needs.

```
// Tool accepts limit/offset params:
read_file({ path: "app.ts", startLine: 50, maxLines: 100 })
grep({ pattern: "TODO", maxResults: 20, offset: 0 })
```

**Who uses it:**
- Claude Code: `read` accepts line range (2,000 lines default), `grep` accepts `head_limit` (250 default)
- OpenCode: `view` tool accepts `offset` (0-based line) + `limit` (default 2000 lines). When truncated, appends: `"(File has more lines. Use 'offset' parameter to read beyond line N)"` — guiding the agent to paginate.
- SWE-agent: `open`, `scroll_up`, `scroll_down`, `goto` for 100-line file windows
- Aider: repo map shows function signatures only; full files read on demand

**Strengths:**
- Prevents bloat at the source — no post-hoc truncation needed
- Agent controls what it sees — can request specific regions
- Most token-efficient: only requested content enters context
- Natural for multi-turn exploration (read a bit, decide, read more)

**Weaknesses:**
- Requires the agent to know what to ask for (cold-start problem)
- Multiple tool calls for one file increases latency and budget
- Tool design complexity — every tool needs pagination support
- Agent may not know where the important content is without seeing the whole thing first

### 1.6 Rejection with guidance

Refuse to return oversized results and tell the agent to narrow its request.

```
if (fileSize > MAX_SIZE) {
  return { error: "File too large (250KB). Use offset/limit params or grep for specific content." }
}
```

**Who uses it:**
- OpenCode: rejects files > 250KB with an error (`"File is too large (X bytes). Maximum size is 256000 bytes"`). No content returned — forces the agent to use a different approach.
- SWE-agent: warns "output too long, try a more specific command"

**Strengths:**
- Forces the agent to be precise
- Zero wasted tokens on content that would be truncated anyway
- Teaches the agent to use narrower queries

**Weaknesses:**
- Burns a tool call on a failure
- Agent needs enough context to know how to narrow the request
- Frustrating in loops where the agent repeatedly fails to narrow correctly

### 1.7 Disk spill with pointer

Write the full result to disk and return a truncated version with a file path pointer.

```
writeFileSync(spillPath, fullResult);
return truncated + `\n[Full result: ${spillPath}]`;
```

**Who uses it:**
- repo-audit-delivery-agent (this project): writes full result to temp dir, returns structure-aware truncated version + path

**Strengths:**
- Full fidelity preserved on disk for debugging
- Truncated result enters context, full result available in theory

**Weaknesses:**
- Useless if no tool exists to read the spill file back (which is the common case)
- The pointer is noise in the context — the LLM can't use it
- Adds filesystem I/O on every oversized result
- The spill file is cleaned up at run end, so it's only useful during the run

---

## Stage 2: Conversation history compression methods

### 2.1 Fixed sliding window

Keep the last N messages; drop everything before that.

```
messages = messages.slice(-WINDOW_SIZE)
```

**Who uses it:**
- Basic pattern in many custom agents
- Not used by major frameworks as the sole strategy (too lossy)

**Strengths:**
- Simple, predictable, zero overhead
- Recent context is always available

**Weaknesses:**
- Binary: either a message is fully present or completely gone
- No gradual degradation — critical early context vanishes abruptly
- Doesn't account for message importance

### 2.2 Tiered age-based compression

Assign messages to tiers by age. Recent messages: full fidelity. Older messages: progressively more compressed.

```
Tier 1 (recent 16 msgs):  full content
Tier 2 (next 15 msgs):    tool results compressed to 600 chars
Tier 3 (everything older): tool results compressed to 200 chars
```

**Who uses it:**
- repo-audit-delivery-agent (this project, pre-upgrade): 3-tier system with configurable char limits. Now superseded — see "Our implementation" section

**Strengths:**
- Graceful degradation — context doesn't disappear, it shrinks
- Older context retains some signal
- No LLM calls needed
- Predictable memory usage

**Weaknesses:**
- Compression is still dumb slicing (same problems as Stage 1 fixed slicing)
- Age is a poor proxy for importance — an early critical finding is just as important as a recent one
- Fixed tier sizes don't scale with different budget sizes
- All tool results in the same tier get the same treatment regardless of content type

### 2.3 Observation count eviction (Last N Observations)

Keep only the last N tool results fully intact. Replace all older observations with a stub.

```
// Keep last 5 tool results; older ones become:
"Old environment output: (47 lines omitted)"
```

**Who uses it:**
- SWE-agent: `LastNObservations(n)` in `history_processors.py` (n is configurable; the original paper used n=5)

**Strengths:**
- Simple and effective — keeps the most operationally relevant results
- Stubs are tiny (one line), so context stays lean
- Works well for sequential exploration where early results are superseded by later ones

**Weaknesses:**
- Loses ALL detail from old results, not just some
- If the agent needs to reference an old result (e.g., to compare two files), it must re-read
- N is fixed — doesn't adapt to conversation dynamics
- No priority awareness — a critical error 6 results ago is lost just like a routine directory listing

### 2.4 Stale observation collapsing

Track which resources (files, URLs) have been viewed. If a resource is viewed again later, collapse the earlier view.

```
// If file X was read at step 5 and again at step 20:
// Step 5 result becomes: "Outdated window with 47 lines omitted..."
// Step 20 result stays fully intact
```

**Who uses it:**
- SWE-agent: `ClosedWindowHistoryProcessor` detects duplicate file views
- repo-audit-delivery-agent: `isFileUnchanged()` + `buildFileSummary()` for re-reads (Stage 1), plus stale-read collapsing in `transformContext` (Stage 2) — see "Our implementation" section

**Strengths:**
- Semantically correct — the latest view is always the most current
- Targeted: only collapses genuinely stale results
- Preserves non-duplicate results at full fidelity

**Weaknesses:**
- Only helps when files are re-read (not all workflows have this pattern)
- Requires tracking which files were read per tool call
- Doesn't help with non-file tool results (grep, API calls, etc.)

### 2.5 LLM-based conversation compaction

Use the LLM itself to summarize the entire conversation history into a compact representation.

```
summary = await llm.call("Summarize this conversation. Focus on what was done, 
  what files were modified, what's left to do.")
messages = [{ role: "system", content: summary }, ...recentMessages]
```

**Who uses it:**
- Claude Code: Anthropic's server-side Compaction API (`compact_20260112`), triggers at configurable token threshold (SDK default 100K tokens)
- OpenCode: `AgentSummarizer` agent at 95% of context window capacity, uses same model as the coding agent
- Anthropic Cookbook: `automatic-context-compaction.ipynb` with customizable summary prompts

**Strengths:**
- Semantically aware — the LLM understands what's important and what's noise
- Produces readable, coherent summaries (not garbled truncated text)
- Can be steered with custom prompts ("focus on errors and file changes")
- Dramatic context reduction (200K tokens → 2K summary)

**Weaknesses:**
- Costs an extra LLM call (latency + tokens)
- Lossy — the LLM may drop details that turn out to be important later
- Summary quality depends on the model (cheaper models produce worse summaries)
- "Nuclear reset" — everything before the summary is gone, no gradual degradation
- Can't be verified — unlike raw results, you can't check if the summary is accurate
- Risk of hallucination in the summary itself

### 2.6 Retrieval-augmented context (memory paging)

Store tool results in an external retrieval system (vector DB, BM25 index). Before each LLM call, retrieve the most relevant results for the current task.

```
// After each tool call:
vectorStore.add(toolResult, metadata={step, tool, file})

// Before each LLM call:
relevant = vectorStore.query(currentTask, topK=5)
messages = [systemPrompt, ...relevant, ...recentMessages]
```

**Who uses it:**
- MemGPT (Packer et al., 2023): virtual context manager with "archival storage" in a vector DB
- AutoGPT / BabyAGI: store task results in Pinecone/Weaviate
- LangChain: `VectorStoreRetrieverMemory` + `ConversationSummaryBufferMemory`

**Strengths:**
- Theoretically optimal — only relevant context enters the window
- Scales to unlimited history (bounded by retrieval, not context window)
- Can surface old but relevant results that recency-based methods would drop

**Weaknesses:**
- Retrieval latency (50-200ms per query) on every turn
- Embedding quality determines retrieval quality — bad embeddings = wrong context
- "Semantic fragmentation" — chunked tool results may lose coherence (LangChain issue #6836 reported this as a dealbreaker)
- Complex infrastructure (vector DB, embedding model, index management)
- Cold-start: at the beginning of a run, there's nothing to retrieve
- Overkill for most agent runs (45 tool calls is manageable without a DB)

### 2.7 Incremental running summary

After each turn, update a running summary that captures the cumulative state. Only the summary + recent messages are sent to the LLM.

```
// After each tool call:
runningSummary = await llm.call(`
  Previous summary: ${runningSummary}
  New tool result: ${latestResult}
  Update the summary to include this new information.
`)
```

**Who uses it:**
- LangChain: `ConversationSummaryMemory` (LLM call after every turn)
- LangChain: `ConversationSummaryBufferMemory` (hybrid: summary for old + buffer for recent)

**Strengths:**
- Context stays bounded regardless of conversation length
- Each summary builds on the previous one — no information cliff
- Recent results stay raw (in the buffer variant)

**Weaknesses:**
- N extra LLM calls (one per turn) — expensive for 40+ turn agent loops
- Summary errors compound — a mistake in turn 5's summary propagates forever
- Latency on every turn
- Summarization itself may hallucinate or drop critical details

### 2.8 Priority-based eviction

Tag tool results by type or importance. Evict low-priority results first, keep high-priority results longer.

```
priority = {
  error: 10,       // always keep
  finding: 9,      // keep as long as possible
  test_result: 8,
  file_read: 5,
  directory_list: 2,  // evict first
  search_result: 4,
}
```

**Who uses it:**
- MemGPT: "importance scoring" for memory pages (closest published work)
- No major framework ships this as a built-in feature

**Strengths:**
- Semantically motivated — errors and findings matter more than directory listings
- Can be combined with any eviction strategy (age + priority)
- Low overhead if priority is assigned by tool type (no LLM needed)

**Weaknesses:**
- Priority assignment is heuristic — a directory listing might reveal a critical missing file
- Requires domain knowledge to set priorities correctly
- Not published or validated in the literature as a standalone strategy

---

## What production systems actually ship

### Per-tool strategy comparison

Systems that handle truncation well use **per-tool strategies** — each tool truncates in a way that suits its content structure. Systems that don't leave it to a shared layer or skip it entirely.

| System | File read | Grep/search | Command output | Shared layer? |
|--------|-----------|-------------|----------------|---------------|
| **Claude Code** | 2K line pagination | 250 entry `head_limit` | Line limit | No — per-tool params |
| **OpenCode** | Reject >250KB; 2K line pagination with offset hint; 2K char/line slice | 100 complete matches; sorted by mod time | 30K middle-cut (first 15K + last 15K) | No — each tool owns its strategy |
| **SWE-agent** | 100-line sliding window with scroll/goto | Match count limit | 100K char cap with head+tail truncation and warning | No — per-tool |
| **OpenHands** | Not documented | Not documented | 30K middle-cut | Shared for bash output only |
| **Continue.dev** | 100K chars / 5K lines | Not documented | 50K chars / 1K lines, tail-biased | Per-tool |
| **This project** | 500 line default, startLine/maxLines, 60K char line-boundary budget | maxResults (200 default), truncated flag | N/A | Yes — `spillAndTruncate` as safety net with JSON/newline boundary awareness |

### Full system comparison

| System | Stage 1 (per-tool) | Stage 2 (history) | LLM involved? |
|--------|-------------------|-------------------|---------------|
| **Claude Code** | Per-tool pagination params | Server-side compaction API (LLM summary, SDK default 100K token threshold) | Yes (compaction) |
| **OpenCode** | Per-tool: reject, paginate, match-drop, or middle-cut depending on tool | LLM summarizer at 95% context | Yes (summary) |
| **SWE-agent** | Per-tool: 100-line window + 100K observation cap | LastNObservations(n) + stale view collapsing | No |
| **OpenHands** | Middle-cut for bash (30K) | None documented | No |
| **Continue.dev** | Per-tool (bash 50K/1K lines; file read 100K/5K lines) | None documented | No |
| **Cursor** | Proprietary | Proprietary (reportedly embedding-based retrieval) | Unknown |
| **Aider** | Stateless per-request; repo map for navigation | No history management (stateless) | No |
| **LangChain** | None built-in | ConversationSummaryBufferMemory (optional) | Yes (optional) |
| **LangGraph** | None built-in | None built-in | No |
| **OpenAI Agents SDK** | None built-in | None built-in | No |
| **MCP Spec** | None (left to tool implementations) | N/A (protocol, not runtime) | N/A |
| **This project** | Per-tool: line-boundary budget (read_file), maxResults (find_files/grep), maxEntries (list_directory), structure-aware spillAndTruncate safety net | Observation eviction + evidence pinning + stale-read collapsing + progress summary steering | No |

---

## Key research findings

### "Lost in the Middle" (Liu et al., 2023)

LLMs attend strongly to the **beginning** and **end** of context, but poorly to the **middle**. This means:

- Recent tool results (at the end of context) get the most attention — good, because they're the most relevant.
- System prompts (at the beginning) get strong attention — good, because they contain instructions.
- Mid-conversation tool results get the least attention — this is exactly what gets compressed by tiered systems.

**Implication:** Aggressive compression of middle-aged content may not hurt quality much, because the LLM wasn't paying attention to it anyway. But promoting high-importance content to the end of context (regardless of age) would be beneficial.

### MemGPT (Packer et al., 2023)

Introduced "virtual context management" — treating the LLM's context window like an OS manages virtual memory, with pages that can be swapped in/out of a backing store. The LLM itself decides what to page in/out via special function calls (`core_memory_append`, `archival_memory_search`).

**Implication:** The agent can manage its own context if given the right tools. But this requires the agent to spend tool calls on memory management rather than the actual task.

### Prompt caching interaction

Anthropic's prompt caching caches the static prefix of the conversation (system prompt + tool definitions) with 90% input token savings on cache hits. Truncation/compression of conversation history (which comes after the cached prefix) does not invalidate the cache. However, rewriting or reordering messages before the cache breakpoint invalidates it.

**Implication:** Stage 2 compression is cache-safe as long as it only modifies messages after the system prompt. Stage 1 truncation is always cache-safe (it modifies tool results, not the system prompt).

### Large context windows don't solve the problem

Even with Gemini's 1M+ token window, studies show generation quality degrades with irrelevant context padding. Google's own agent frameworks still implement context windowing. The cost argument alone justifies truncation: at $1.25/MTok (Gemini Pro), sending 1M tokens per turn in a 40-turn loop costs $50 per run.

---

## Our implementation

This project uses a layered approach combining per-tool structural truncation (Stage 1), observation eviction with evidence pinning (Stage 2), and progress summary steering. No LLM calls are used for context management.

### Stage 1: Per-tool result truncation

Each tool enforces its own limits at natural content boundaries. The shared `spillAndTruncate` layer in `src/tools/piToolAdapter.ts` is a safety net that rarely fires.

| Tool | Strategy | File |
|------|----------|------|
| `read_file` / `read_files_batch` | 500-line default, startLine/maxLines pagination, 60K char budget with line-boundary truncation + pagination hint | `src/tools/utils/resolveAndRead.ts` |
| `find_files` | `maxResults` param (default 200), early-exit walk, returns `truncated` flag | `src/tools/search/findFiles.ts` |
| `list_directory` | `maxEntries` param (default 200), early-exit walk | `src/tools/repo/listDirectory.ts` |
| `grep_pattern` | `maxResults` param (default 50), drops complete matches beyond limit | `src/tools/search/grepPattern.ts` |
| All tools (safety net) | `spillAndTruncate` cuts at JSON object boundary (`},` / `}]`), then newline, then raw slice as last resort. Spills full result to disk. | `src/tools/piToolAdapter.ts` → `truncateAtBoundary()` |

### Stage 2: Conversation history compression (`transformContext`)

Before each LLM call, `transformContext` in `src/agent/runner.ts` rewrites the message array. Instead of the old 3-tier char-slicing (which garbled JSON mid-key), it uses categorical eviction:

| Category | Behavior | Rationale |
|----------|----------|-----------|
| **Recent window** (last 12 messages, or 8 after model switch) | Full fidelity | LLM attends most strongly to recent context |
| **Writing tools** (`record_finding`, `assemble_output`, `switch_to_fast_model`) | Never compressed | Writing phase output must survive intact |
| **Evidence-pinned** (toolCallIds whose files appear in `state.findings[].evidence[].filePath`) | Never compressed | The writing phase needs raw evidence from investigation |
| **Stale reads** (same file read again later, superseded) | Collapsed to `"[superseded — file re-read in a later tool call]"` | Only the latest read of a file is current |
| **Everything else** | Stubbed to one-liner: `"[{toolName}: {firstLine}... ({N} chars)]"` | Reduces noise while preserving a breadcrumb |

Key implementation details:
- `toolCallIdToFiles` and `toolCallIdToName` maps (populated in `afterToolCall`) track which files each tool call touched
- Evidence files are extracted from `state.findings[].evidence[].filePath` on each pass
- Stubs are cached by toolCallId in `summaryCache` to avoid recomputation
- `snipBoundaryActive` (set after model switch to fast model) shrinks the recent window from 12 to 8

### Stage 3: Progress summary steering

At 70% budget consumed, a deterministic progress checkpoint is injected via `agent.steer()` in `afterToolCall`. This compensates for evicted context by telling the LLM what it has already done:

- Files read (top 20 from `state.filesRead`)
- Findings recorded (category + title from `state.findings`)
- Categories covered (deduplicated from findings)
- Budget remaining

This prevents the LLM from re-investigating areas whose tool results were evicted. Cost: zero (no LLM call — pure state extraction).

### Budget warning chain

Separate from context management, budget steering messages fire at fixed thresholds:

| Threshold | Action |
|-----------|--------|
| 40% budget used, 0 findings | Nudge to start recording findings immediately |
| 50% budget used | Remind to call `switch_to_fast_model` |
| 70% budget used | Progress summary checkpoint (see Stage 3) |
| 5 calls remaining | Force-switch to fast model if not already switched |

---

## Decision framework

### When to use each approach

| Situation | Recommended approach |
|-----------|---------------------|
| Individual tool returns too much data | Pagination + structural boundary truncation |
| Conversation history growing over 40+ turns | LLM compaction (if budget allows) or observation eviction |
| Cost-sensitive, many runs per day | Tiered age-based compression (no LLM calls) |
| Critical results must survive compression | Priority-based eviction or evidence pinning |
| Agent frequently re-reads same files | Stale observation collapsing |
| Debugging requires full fidelity | Disk spill (but add a tool to read it back) |
| Single-shot tasks, no multi-turn | Stateless per-request (Aider pattern) |

### Combining approaches (recommended)

The most effective systems combine multiple strategies:

1. **Tool level:** Pagination params so the agent requests only what it needs (prevents bloat)
2. **Result level:** Structural boundary truncation as a safety net (clean cuts)
3. **History level:** Observation eviction or tiered compression (manages growth)
4. **Threshold trigger:** LLM compaction when context exceeds a threshold (deep compression)
5. **Special case:** Stale read collapsing + evidence pinning (targeted optimization)

No single approach is sufficient. The layers complement each other.

---

## Glossary

| Term | Definition |
|------|------------|
| **Compaction** | LLM-based summarization of conversation history, replacing detailed messages with a summary |
| **Context window** | The maximum number of tokens an LLM can process in a single API call |
| **Evidence pinning** | Keeping tool results that contain cited evidence at full fidelity regardless of age |
| **Observation eviction** | Replacing old tool results with stubs, keeping only recent results intact |
| **Pagination** | Tool design pattern where results are returned in pages (offset + limit) |
| **Progress summary** | Deterministic checkpoint injected at a budget threshold, listing files read, findings recorded, and categories covered to prevent re-investigation of evicted context |
| **Snip boundary** | A point in the conversation after which tighter compression rules apply |
| **Spill** | Writing a full tool result to disk when it exceeds the in-context size limit |
| **Stale collapsing** | Replacing an earlier read of a file with a stub when the same file is read again later |
| **Structural truncation** | Truncating at natural boundaries (lines, matches, objects) instead of arbitrary character offsets |
| **Tiered compression** | Compressing messages to different levels based on their age in the conversation |

---

## References

- Liu, N. F. et al. (2023). "Lost in the Middle: How Language Models Use Long Contexts." arXiv:2307.03172.
- Packer, C. et al. (2023). "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560.
- Anthropic. "Prompt Caching." docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
- Anthropic. "Automatic Context Compaction." anthropic-cookbook, automatic-context-compaction.ipynb.
- SWE-agent. github.com/SWE-agent/SWE-agent, `history_processors.py`.
- OpenCode. github.com/opencode-ai/opencode, `internal/llm/tools/`.
- OpenHands. github.com/All-Hands-AI/OpenHands, `commands.py`.
- LangChain. "Memory." python.langchain.com/docs/modules/memory/.
- Model Context Protocol. modelcontextprotocol.io/specification.
