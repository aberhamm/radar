import type { Scorecard, CategoryScore } from '../types/output.js';
import type { Finding } from '../types/findings.js';
import type { InvestigationEntry, FetchedDoc } from '../types/state.js';

/**
 * Render a scorecard + agent-written sections into a consultant-readable markdown brief.
 */
export function renderBrief(
  scorecard: Scorecard,
  sections: Record<string, string>,
  investigationLog: InvestigationEntry[],
  fetchedDocs: FetchedDoc[],
  toolCallsUsed: number,
  toolCallBudget: number,
): string {
  const lines: string[] = [];

  lines.push(`# Project ${briefTitle(scorecard.goalType)}: ${scorecard.repoName}`);
  lines.push('');
  lines.push(`**Generated:** ${scorecard.generatedAt}`);
  lines.push(`**Goal:** ${scorecard.goalType}`);
  lines.push(`**Investigation depth:** ${toolCallsUsed} / ${toolCallBudget} tool calls`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Render agent-written sections
  const sectionOrder = [
    'project_overview',
    'stack_and_architecture',
    'key_files',
    'cms_integration',
    'preview_editing',
    'configuration_environment',
    'local_setup',
    'scorecard',
    'top_risks',
    'first_week_reading',
    'client_questions',
    'next_actions',
    // Audit/migration sections
    'migration_hotspots',
    'migration_order',
    'component_inventory',
  ];

  for (const key of sectionOrder) {
    if (sections[key]) {
      lines.push(sections[key]);
      lines.push('');
    }
  }

  // Any sections not in the predefined order
  for (const [key, content] of Object.entries(sections)) {
    if (!sectionOrder.includes(key) && content) {
      lines.push(content);
      lines.push('');
    }
  }

  // Architecture scorecard (always rendered from computed data)
  lines.push('## Architecture Scorecard');
  lines.push('');
  lines.push(`**Overall: ${scoreEmoji(scorecard.overallScore)} ${scorecard.overallScore.toUpperCase()}**`);
  lines.push('');
  lines.push('| Category | Score | Findings | Summary |');
  lines.push('|----------|-------|----------|---------|');
  for (const cat of scorecard.categories) {
    lines.push(
      `| ${categoryDisplayName(cat)} | ${scoreEmoji(cat.score)} ${cat.score} | ${cat.findings.length} | ${cat.summary} |`,
    );
  }
  lines.push('');

  // Top risks
  if (scorecard.topRisks.length > 0) {
    lines.push('## Top Risks');
    lines.push('');
    for (let i = 0; i < scorecard.topRisks.length; i++) {
      const risk = scorecard.topRisks[i];
      lines.push(`### ${i + 1}. ${risk.title}`);
      lines.push(`**Severity:** ${risk.severity} | **Category:** ${risk.category}`);
      lines.push('');
      lines.push(risk.description);
      if (risk.evidence.length > 0) {
        lines.push('');
        for (const ev of risk.evidence) {
          lines.push(`- \`${ev.filePath}\`${ev.lineNumber ? `:${ev.lineNumber}` : ''}: ${ev.description}`);
        }
      }
      lines.push('');
    }
  }

  // Documentation sources
  if (fetchedDocs.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Documentation Sources');
    lines.push('');
    for (const doc of fetchedDocs) {
      lines.push(`- [${doc.title}](${doc.url}) — used in findings: ${doc.usedInFindings.join(', ') || 'general context'}`);
    }
    lines.push('');
  }

  // Investigation log
  if (investigationLog.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Investigation Log');
    lines.push('');
    for (const entry of investigationLog) {
      lines.push(`**Step ${entry.step}:** ${entry.action}`);
      lines.push(`> ${entry.reasoning}`);
      lines.push(`Result: ${entry.result}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function briefTitle(goalType: string): string {
  switch (goalType) {
    case 'onboarding': return 'Onboarding Brief';
    case 'audit': return 'Architecture Audit';
    case 'migration': return 'Migration Scout Report';
    case 'component-map': return 'Component Map';
    case 'ci-check': return 'CI Health Check';
    default: return 'Analysis Report';
  }
}

function scoreEmoji(score: string): string {
  switch (score) {
    case 'red': return '🔴';
    case 'yellow': return '🟡';
    case 'green': return '🟢';
    default: return '⚪';
  }
}

function categoryDisplayName(cat: CategoryScore): string {
  // Map category codes back to display names
  const map: Record<string, string> = {
    stack: 'Stack & Framework',
    nextjs: 'Stack & Framework',
    'cms-integration': 'CMS Integration',
    'preview-editing': 'Preview & Editing',
    security: 'Security & Configuration',
    configuration: 'Security & Configuration',
    architecture: 'Architecture',
    routing: 'Architecture',
    'data-fetching': 'Architecture',
    dependencies: 'Dependencies',
    deployment: 'Deployment',
  };
  return map[cat.category] ?? cat.category;
}
