'use client';

/**
 * Architecture diagram panel for the How It Works page.
 * Shows the four-layer stack + deep-dive sections that match the demo script.
 *
 * Design: vertical stepper with dots + connecting line, then detail cards.
 * Follows DESIGN.md: no colored left-border cards, no decorative gradients.
 */

const LAYERS = [
  {
    name: 'Consulting Rules',
    stat: '17 files',
    lines: [
      'Plain English markdown, written by architects.',
      'Core rules + platform rules + goal rules, composed per run.',
    ],
  },
  {
    name: 'Pi Agent Runtime',
    stat: 'Dual-model',
    lines: [
      'Observe \u2192 reason \u2192 act loop. Decides what to investigate.',
      'Parallel tool execution, budget enforcement, model switching.',
    ],
  },
  {
    name: '23 Deterministic Tools',
    stat: '21 parallel',
    lines: [
      'Read files, parse configs, search code, query npm.',
      'Return facts. Never call an LLM. Never reason.',
    ],
  },
  {
    name: 'Structured Output',
    stat: '10 goals',
    lines: [
      'Scorecard, findings, brief, PDF, SARIF, GitHub Issues.',
      'Schema-enforced, evidence-verified, scored.',
    ],
  },
] as const;

const DEEP_DIVES = [
  {
    title: 'Rules Are Markdown',
    items: [
      'Goal rule files define categories, severity criteria, and evidence patterns in plain English.',
      'New audit type? Write a markdown file. No code changes — the agent picks it up on the next run.',
      'A senior architect writes the rules. The LLM follows them.',
    ],
  },
  {
    title: 'Provider-Agnostic Config',
    items: [
      'Two models built from environment variables: AGENT_MODEL (investigation) and FAST_MODEL (writing).',
      'Role-based names, not model names. The code never says "Sonnet" or "Haiku."',
      'Swap from AWS Bedrock to Azure OpenAI by changing two env vars. No code changes.',
    ],
  },
  {
    title: 'The Agent Loop',
    items: [
      'Pi Agent\'s observe-reason-act loop with parallel tool execution — five files read at once.',
      'beforeToolCall: budget gate. Enforces per-tool quotas and forces recording if 75% budget spent with zero findings.',
      'afterToolCall: state tracking. Nudges model switch at 50%, sends critical message at 5 calls remaining.',
      'transformContext: three-tier compression keeps conversation under the context window.',
    ],
  },
  {
    title: 'Dual-Model Cost Trick',
    items: [
      'Sonnet investigates (expensive, powerful). Haiku writes the report (fast, cheap).',
      'Pi captures the model by reference — so we mutate the object in place with Object.assign.',
      'No abort, no restart, no lost context. The next LLM call just goes to a different model.',
      'After the switch, context compression gets aggressive — writing doesn\'t need raw file contents.',
      'Result: 74¢ per goal instead of $2.',
    ],
  },
  {
    title: 'Budget Planner',
    items: [
      'Before any LLM call, four deterministic tools run in parallel: detect app roots, parse package.json, list tree, load prompts.',
      'Signal matrix splits budget across passes: Next.js + UI framework → 60% core / 20% Next.js / 20% a11y.',
      'After each pass, rebalanceBudget() adjusts: false positives skipped, simple repos shrunk, covered categories reduced.',
      'Pure functions. No LLM, no I/O. Deterministic budget intelligence.',
    ],
  },
  {
    title: 'Evidence Verification',
    items: [
      'LLMs hallucinate — especially after long conversations push original file reads out of context.',
      'Every record_finding call is normalized from 6 different argument shapes the LLM produces.',
      'For every evidence citation: did the agent actually read that file? Is the snippet really in it?',
      'Mismatched snippets auto-correct to real code. Unread files get evidence rejected entirely.',
      'Post-loop pass re-reads every cited file from disk. No LLM involved — pure string matching.',
    ],
  },
  {
    title: 'Prompt Injection Defense',
    items: [
      'The agent reads files from repos we don\'t control. Code comments could contain adversarial instructions.',
      'Every tool output wrapped in open/close delimiters — system prompt says: treat contents as data, not instructions.',
      '11 pattern detectors: "ignore previous instructions," "you are now," delimiter escape attempts, etc.',
      'Suspicious patterns in finding content get flagged automatically.',
    ],
  },
] as const;

export function HowItWorksPanel() {
  return (
    <div data-component="HowItWorksPanel" className="flex flex-col gap-6">
      {/* Four-layer architecture */}
      <div className="bg-surface rounded-xl border border-separator shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-separator flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-label tracking-tight">
            How Radar Works
          </h2>
          <span className="text-[11px] text-tertiary-label">
            4-layer architecture
          </span>
        </div>

        <div className="px-5 py-4">
          <div className="relative">
            {LAYERS.map((layer, i) => {
              const isLast = i === LAYERS.length - 1;
              return (
                <div key={layer.name} className="relative flex gap-3.5">
                  <div className="flex flex-col items-center shrink-0 w-5">
                    <div className="w-[7px] h-[7px] rounded-full bg-tint mt-[7px] shrink-0" />
                    {!isLast && (
                      <div className="w-px flex-1 bg-separator mt-1 mb-1" />
                    )}
                  </div>

                  <div className={isLast ? 'pb-0' : 'pb-4'}>
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-[13px] font-semibold text-label leading-snug">
                        {layer.name}
                      </h3>
                      <span className="text-[11px] font-mono text-tertiary-label">
                        {layer.stat}
                      </span>
                    </div>
                    {layer.lines.map((line, j) => (
                      <p
                        key={j}
                        className="text-[12px] text-secondary-label leading-relaxed mt-0.5"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3.5 border-t border-separator">
            <p className="text-[12px] text-tertiary-label leading-relaxed">
              No layer reaches into another. Tools don&apos;t know about rules.
              Rules don&apos;t know about output formats. The agent connects them.
            </p>
          </div>
        </div>
      </div>

      {/* Deep-dive sections */}
      {DEEP_DIVES.map((section) => (
        <div
          key={section.title}
          className="bg-surface rounded-xl border border-separator shadow-sm overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-separator">
            <h2 className="text-[13px] font-semibold text-label tracking-tight">
              {section.title}
            </h2>
          </div>
          <ul className="px-5 py-4 flex flex-col gap-2">
            {section.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[12px] text-secondary-label leading-relaxed">
                <span className="text-tertiary-label shrink-0 mt-px">&bull;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
