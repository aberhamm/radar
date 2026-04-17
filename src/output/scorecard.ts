import type { Finding, FindingCategory, Severity } from '../types/findings.js';
import type { Scorecard, CategoryScore, ScoreLevel } from '../types/output.js';
import type { GoalType } from '../types/state.js';

/**
 * Scorecard categories — maps finding categories to scorecard display categories.
 * Multiple finding categories can roll up into one scorecard category.
 */
const ONBOARDING_CATEGORY_MAP: Record<string, FindingCategory[]> = {
  'Stack & Framework': ['stack', 'nextjs'],
  'CMS Integration': ['cms-integration'],
  'Preview & Editing': ['preview-editing'],
  'Security & Configuration': ['security', 'configuration'],
  Architecture: ['architecture', 'routing', 'data-fetching'],
  Dependencies: ['dependencies'],
  Deployment: ['deployment'],
};

const SECURITY_CATEGORY_MAP: Record<string, FindingCategory[]> = {
  'Secrets & Environment': ['secrets', 'security'],
  'Authentication & Authorization': ['auth'],
  'Security Headers': ['configuration'],
  'Dependency Security': ['dependencies'],
  'Input Validation': ['input-validation'],
  'Data Exposure': ['data-exposure'],
};

const NEXTJS_CATEGORY_MAP: Record<string, FindingCategory[]> = {
  'Router Architecture': ['routing', 'architecture'],
  'Data Fetching': ['data-fetching'],
  'Rendering Strategy': ['nextjs'],
  Performance: ['performance'],
  Configuration: ['configuration'],
  Dependencies: ['dependencies'],
  'TypeScript & DX': ['stack', 'dx'],
};

const ACCESSIBILITY_CATEGORY_MAP: Record<string, FindingCategory[]> = {
  'Images & Media': ['media-alt'],
  'Semantic Structure': ['semantic-html'],
  'Keyboard & Focus': ['keyboard-focus'],
  'Forms & Inputs': ['forms'],
  'Color & Contrast': ['color-contrast'],
  'Dynamic Content': ['aria'],
};

const GENERIC_CATEGORY_MAP: Record<string, FindingCategory[]> = {
  'Stack & Framework': ['stack'],
  'Security & Configuration': ['security', 'configuration'],
  Architecture: ['architecture', 'routing', 'data-fetching'],
  Dependencies: ['dependencies'],
  'Testing & Quality': ['testing'],
  'Deployment & Operations': ['deployment'],
  'Documentation & DX': ['dx'],
};

function getCategoryMap(goal: GoalType): Record<string, FindingCategory[]> {
  if (goal === 'security-review') return SECURITY_CATEGORY_MAP;
  if (goal === 'nextjs') return NEXTJS_CATEGORY_MAP;
  if (goal === 'accessibility') return ACCESSIBILITY_CATEGORY_MAP;
  if (goal === 'audit-generic') return GENERIC_CATEGORY_MAP;
  return ONBOARDING_CATEGORY_MAP;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Compute a scorecard from accumulated findings.
 * Scoring rules (from consulting rules, deterministic):
 *   Red: any critical, or 3+ high
 *   Yellow: any high, or 3+ medium
 *   Green: only medium, low, or info
 */
export function computeScorecard(
  repoName: string,
  goalType: GoalType,
  findings: Finding[],
): Scorecard {
  const categories: CategoryScore[] = [];

  // Filter out very low confidence findings (1-2) — not enough evidence to score
  const scorableFindings = findings.filter((f) => (f.confidence ?? 7) > 2);

  const categoryMap = getCategoryMap(goalType);
  for (const [displayName, findingCategories] of Object.entries(categoryMap)) {
    const categoryFindings = scorableFindings.filter((f) =>
      findingCategories.includes(f.category),
    );

    const score = computeCategoryScore(categoryFindings);
    const summary = buildCategorySummary(displayName, categoryFindings, score);

    categories.push({
      category: displayName,
      score,
      findings: categoryFindings,
      summary,
    });
  }

  const overallScore = computeOverallScore(categories);

  // Top risks: highest severity findings, up to 5 (confidence as tiebreaker)
  const topRisks = [...scorableFindings]
    .filter((f) => f.severity !== 'info')
    .sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return (b.confidence ?? 7) - (a.confidence ?? 7);
    })
    .slice(0, 5);

  return {
    repoName,
    goalType,
    generatedAt: new Date().toISOString(),
    overallScore,
    categories,
    topRisks,
  };
}

function computeCategoryScore(findings: Finding[]): ScoreLevel {
  const counts = countBySeverity(findings);

  if (counts.critical > 0 || counts.high >= 3) return 'red';
  if (counts.high > 0 || counts.medium >= 3) return 'yellow';
  return 'green';
}

function computeOverallScore(categories: CategoryScore[]): ScoreLevel {
  const hasRed = categories.some((c) => c.score === 'red');
  if (hasRed) return 'red';

  const hasYellow = categories.some((c) => c.score === 'yellow');
  if (hasYellow) return 'yellow';

  return 'green';
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

function buildCategorySummary(
  name: string,
  findings: Finding[],
  score: ScoreLevel,
): string {
  if (findings.length === 0) {
    return `${name}: Not yet assessed — no findings recorded for this category.`;
  }

  const counts = countBySeverity(findings);
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);
  if (counts.info > 0) parts.push(`${counts.info} info`);

  const emoji = score === 'red' ? '🔴' : score === 'yellow' ? '🟡' : '🟢';
  return `${emoji} ${name}: ${parts.join(', ')} (${findings.length} total)`;
}
