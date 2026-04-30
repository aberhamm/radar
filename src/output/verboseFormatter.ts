import type { StepEvent } from '../agent/runner.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

export function formatVerboseStep(step: StepEvent, repoPrefix?: string): void {
  const tag = repoPrefix ? `${DIM}[${repoPrefix}]${RESET} ` : '';
  const prefix = `${tag}${DIM}[Step ${step.step}]${RESET}`;

  switch (step.type) {
    case 'text_delta':
    case 'tool_start':
      return; // transient streaming events — skip in verbose output
    case 'text_response': {
      console.log(`\n${prefix} ${MAGENTA}${BOLD}Agent thinking:${RESET}`);
      const text = step.fullReasoning ?? step.reasoning ?? '';
      for (const line of wrapText(text, 100)) {
        console.log(`  ${DIM}${line}${RESET}`);
      }
      break;
    }

    case 'finding_progress': {
      const d = step.details;
      if (!d) break;
      const phase = d.phase as string;
      if (phase === 'verifying_evidence') {
        process.stdout.write(`${prefix} ${DIM}  verifying evidence ${d.evidenceIndex}/${d.evidenceTotal}: ${d.evidenceFile}${RESET}\r`);
      } else if (phase === 'evidence_verified') {
        const statusColor = d.evidenceStatus === 'rejected' ? RED : d.evidenceStatus === 'corrected' ? YELLOW : GREEN;
        console.log(`${prefix} ${DIM}  evidence ${d.evidenceIndex}/${d.evidenceTotal}:${RESET} ${statusColor}${d.evidenceStatus}${RESET} ${DIM}${d.evidenceFile}${RESET}`);
      } else if (phase === 'finding_recorded') {
        console.log(`${prefix} ${GREEN}  ✓ ${d.findingId} recorded (${d.findingIndex}/${d.findingTotal} in batch)${RESET}`);
      }
      break;
    }

    case 'finding': {
      const d = step.details;
      const findingId = d?.findingId ?? '?';
      const severity = d?.severity ? String(d.severity).toUpperCase() : null;
      const evidenceCount = typeof d?.evidenceCount === 'number' ? d.evidenceCount : null;

      try {
        const parsed = JSON.parse(step.fullResult ?? step.result ?? '{}');
        if (parsed.error) {
          console.log(`${prefix} ${RED}Finding error: ${parsed.error}${RESET}`);
        } else {
          const total = parsed.totalFindings ?? '';
          const evHint = evidenceCount != null ? ` [${evidenceCount} evidence file${evidenceCount > 1 ? 's' : ''}]` : '';
          console.log(`${prefix} ${GREEN}${BOLD}FINDING RECORDED: ${findingId}${RESET}${total ? ` (${total} total)` : ''}${evHint}`);
          if (step.args) {
            try {
              const args = JSON.parse(step.args);
              const finding = args.finding ?? args;
              if (finding.title) {
                console.log(`  ${BOLD}${severity ?? finding.severity?.toUpperCase() ?? 'INFO'}:${RESET} ${finding.title}`);
              }
              if (finding.description) {
                const desc = finding.description.slice(0, 200);
                console.log(`  ${DIM}${desc}${desc.length < finding.description.length ? '...' : ''}${RESET}`);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      } catch {
        console.log(`${prefix} ${GREEN}Finding: ${step.result}${RESET}`);
      }
      break;
    }

    case 'assemble_output': {
      console.log(`\n${prefix} ${CYAN}${BOLD}ASSEMBLING OUTPUT${RESET} — ${step.result}`);
      if (step.fullResult) {
        console.log(`  ${DIM}Sections: ${step.fullResult}${RESET}`);
      }
      break;
    }

    case 'budget_warning': {
      console.log(`${prefix} ${YELLOW}${BOLD}${step.result}${RESET}`);
      break;
    }

    default: {
      const toolName = step.action;
      const shortResult = step.result?.slice(0, 80) ?? '';

      if (step.fullReasoning) {
        const reasoning = step.fullReasoning.trim();
        if (reasoning) {
          console.log(`\n${prefix} ${MAGENTA}${BOLD}Reasoning:${RESET}`);
          for (const line of wrapText(reasoning, 100)) {
            console.log(`  ${DIM}${line}${RESET}`);
          }
        }
      }

      console.log(`${prefix} ${CYAN}${toolName}${RESET} → ${DIM}${shortResult}${RESET}`);

      if (step.args) {
        try {
          const args = JSON.parse(step.args);
          const argStr = JSON.stringify(args, null, 0);
          if (argStr.length > 2) {
            console.log(`  ${DIM}args: ${argStr.slice(0, 120)}${argStr.length > 120 ? '...' : ''}${RESET}`);
          }
        } catch { /* ignore */ }
      }
    }
  }
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
    } else {
      let remaining = para;
      while (remaining.length > width) {
        const breakAt = remaining.lastIndexOf(' ', width);
        const idx = breakAt > 0 ? breakAt : width;
        lines.push(remaining.slice(0, idx));
        remaining = remaining.slice(idx + 1);
      }
      if (remaining) lines.push(remaining);
    }
  }
  return lines;
}
