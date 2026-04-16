'use client';

/**
 * Architecture diagram panel for the IdleView.
 * Shows the four-layer stack that powers Radar.
 *
 * Design: vertical stepper with dots + connecting line.
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

export function HowItWorksPanel() {
  return (
    <div className="bg-surface rounded-xl border border-separator shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-separator flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-label tracking-tight">
          How Radar Works
        </h2>
        <span className="text-[11px] text-tertiary-label">
          4-layer architecture
        </span>
      </div>

      {/* Stepper */}
      <div className="px-5 py-4">
        <div className="relative">
          {LAYERS.map((layer, i) => {
            const isLast = i === LAYERS.length - 1;
            return (
              <div key={layer.name} className="relative flex gap-3.5">
                {/* Vertical line + dot */}
                <div className="flex flex-col items-center shrink-0 w-5">
                  {/* Dot */}
                  <div className="w-[7px] h-[7px] rounded-full bg-tint mt-[7px] shrink-0" />
                  {/* Line */}
                  {!isLast && (
                    <div className="w-px flex-1 bg-separator mt-1 mb-1" />
                  )}
                </div>

                {/* Content */}
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

        {/* Principle */}
        <div className="mt-4 pt-3.5 border-t border-separator">
          <p className="text-[12px] text-tertiary-label leading-relaxed">
            No layer reaches into another. Tools don&apos;t know about rules.
            Rules don&apos;t know about output formats. The agent connects them.
          </p>
        </div>
      </div>
    </div>
  );
}
