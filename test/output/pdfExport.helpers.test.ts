import { describe, it, expect } from 'vitest';

// ─── Inline copies of pure helper functions from pdfExport.ts ───
// These are not exported, so we replicate the logic for direct unit testing.

type ScoreLevel = 'red' | 'yellow' | 'green';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const COLORS = {
  danger: '#ff3b30',
  warning: '#ff9500',
  success: '#34c759',
  info: '#5ac8fa',
  labelTertiary: '#86868b',
} as const;

function scoreColor(score: ScoreLevel): string {
  switch (score) {
    case 'red': return COLORS.danger;
    case 'yellow': return COLORS.warning;
    case 'green': return COLORS.success;
  }
}

function severityColor(severity: Severity): string {
  switch (severity) {
    case 'critical': return COLORS.danger;
    case 'high': return '#e03e2d';
    case 'medium': return COLORS.warning;
    case 'low': return COLORS.info;
    case 'info': return COLORS.labelTertiary;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
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
  performance: 'Performance',
  accessibility: 'Accessibility',
  forms: 'Forms & Inputs',
  aria: 'Dynamic Content',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function goalTitle(goalType: string): string {
  const titles: Record<string, string> = {
    onboarding: 'Onboarding Brief',
    audit: 'Architecture Audit',
    'audit-generic': 'Architecture Audit',
    migration: 'Migration Scout Report',
    'component-map': 'Component Map',
    'ci-check': 'CI Health Check',
    'security-review': 'Security Review',
    nextjs: 'Next.js Health Check',
    accessibility: 'Accessibility Audit',
  };
  return titles[goalType] ?? 'Analysis Report';
}

interface SimpleScorecard {
  overallScore: ScoreLevel;
  categories: Array<{ score: ScoreLevel; findings: unknown[] }>;
}

function scoreVerdictLine(scorecard: SimpleScorecard): string {
  const redCount = scorecard.categories.filter(c => c.score === 'red').length;
  const yellowCount = scorecard.categories.filter(c => c.score === 'yellow').length;
  const totalCats = scorecard.categories.length;

  switch (scorecard.overallScore) {
    case 'red':
      return `${redCount} of ${totalCats} categories have critical issues requiring immediate attention.`;
    case 'yellow':
      return `${yellowCount} of ${totalCats} categories have issues worth addressing. No critical blockers.`;
    case 'green':
      return `All ${totalCats} categories are healthy. No significant issues found.`;
  }
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

// ─── scoreColor ───

describe('scoreColor', () => {
  it('returns danger for red', () => {
    expect(scoreColor('red')).toBe('#ff3b30');
  });

  it('returns warning for yellow', () => {
    expect(scoreColor('yellow')).toBe('#ff9500');
  });

  it('returns success for green', () => {
    expect(scoreColor('green')).toBe('#34c759');
  });
});

// ─── severityColor ───

describe('severityColor', () => {
  it('maps all five severities to distinct colors', () => {
    const colors = new Set([
      severityColor('critical'),
      severityColor('high'),
      severityColor('medium'),
      severityColor('low'),
      severityColor('info'),
    ]);
    expect(colors.size).toBe(5);
  });

  it('returns danger for critical', () => {
    expect(severityColor('critical')).toBe('#ff3b30');
  });

  it('returns a distinct red for high', () => {
    expect(severityColor('high')).toBe('#e03e2d');
    expect(severityColor('high')).not.toBe(severityColor('critical'));
  });
});

// ─── categoryLabel ───

describe('categoryLabel', () => {
  it('maps known categories', () => {
    expect(categoryLabel('security')).toBe('Security & Configuration');
    expect(categoryLabel('stack')).toBe('Stack & Framework');
    expect(categoryLabel('accessibility')).toBe('Accessibility');
    expect(categoryLabel('aria')).toBe('Dynamic Content');
  });

  it('maps aliases to same label', () => {
    expect(categoryLabel('routing')).toBe(categoryLabel('architecture'));
    expect(categoryLabel('data-fetching')).toBe(categoryLabel('architecture'));
    expect(categoryLabel('configuration')).toBe(categoryLabel('security'));
    expect(categoryLabel('nextjs')).toBe(categoryLabel('stack'));
  });

  it('falls back to raw string for unknown categories', () => {
    expect(categoryLabel('banana')).toBe('banana');
    expect(categoryLabel('')).toBe('');
  });
});

// ─── goalTitle ───

describe('goalTitle', () => {
  it('maps all known goal types', () => {
    expect(goalTitle('onboarding')).toBe('Onboarding Brief');
    expect(goalTitle('audit')).toBe('Architecture Audit');
    expect(goalTitle('audit-generic')).toBe('Architecture Audit');
    expect(goalTitle('migration')).toBe('Migration Scout Report');
    expect(goalTitle('component-map')).toBe('Component Map');
    expect(goalTitle('ci-check')).toBe('CI Health Check');
    expect(goalTitle('security-review')).toBe('Security Review');
    expect(goalTitle('nextjs')).toBe('Next.js Health Check');
    expect(goalTitle('accessibility')).toBe('Accessibility Audit');
  });

  it('falls back to "Analysis Report" for unknown goals', () => {
    expect(goalTitle('unknown-goal')).toBe('Analysis Report');
    expect(goalTitle('')).toBe('Analysis Report');
  });
});

// ─── scoreVerdictLine ───

describe('scoreVerdictLine', () => {
  it('mentions red count for red scorecard', () => {
    const sc: SimpleScorecard = {
      overallScore: 'red',
      categories: [
        { score: 'red', findings: [{}] },
        { score: 'red', findings: [{}] },
        { score: 'green', findings: [] },
      ],
    };
    const line = scoreVerdictLine(sc);
    expect(line).toContain('2 of 3');
    expect(line).toContain('critical issues');
  });

  it('mentions yellow count for yellow scorecard', () => {
    const sc: SimpleScorecard = {
      overallScore: 'yellow',
      categories: [
        { score: 'yellow', findings: [{}] },
        { score: 'green', findings: [] },
      ],
    };
    const line = scoreVerdictLine(sc);
    expect(line).toContain('1 of 2');
    expect(line).toContain('No critical blockers');
  });

  it('mentions all healthy for green scorecard', () => {
    const sc: SimpleScorecard = {
      overallScore: 'green',
      categories: [
        { score: 'green', findings: [] },
        { score: 'green', findings: [] },
        { score: 'green', findings: [] },
        { score: 'green', findings: [] },
      ],
    };
    const line = scoreVerdictLine(sc);
    expect(line).toContain('All 4');
    expect(line).toContain('healthy');
  });
});

// ─── truncate ───

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncate('a'.repeat(50), 20)).toBe('a'.repeat(17) + '...');
  });

  it('returns text at exact maxLen unchanged', () => {
    const text = 'a'.repeat(20);
    expect(truncate(text, 20)).toBe(text);
  });

  it('collapses newlines to spaces', () => {
    expect(truncate('line1\nline2\nline3', 100)).toBe('line1 line2 line3');
  });

  it('trims whitespace', () => {
    expect(truncate('  padded  ', 100)).toBe('padded');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles maxLen of 3 (minimum for ellipsis)', () => {
    expect(truncate('abcdef', 3)).toBe('...');
  });
});

// ─── formatDuration ───

describe('formatDuration', () => {
  it('formats sub-minute as seconds', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats exact minute', () => {
    expect(formatDuration(60_000)).toBe('1m');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('formats multi-minute duration', () => {
    expect(formatDuration(480_000)).toBe('8m');
  });

  it('rounds sub-second values', () => {
    expect(formatDuration(500)).toBe('1s');
  });

  it('formats zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats over one hour', () => {
    expect(formatDuration(3_661_000)).toBe('61m 1s');
  });

  it('drops seconds when exactly on minute boundary', () => {
    expect(formatDuration(120_000)).toBe('2m');
  });
});
