/** Merge class names, filtering out falsy values. */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ');
}

// ─── Score helpers (shared across dashboard components) ─────────

export type ScoreLevel = 'red' | 'yellow' | 'green';

export function scoreColor(score: string): string {
  return score === 'red' ? '#ff3b30' : score === 'yellow' ? '#ff9500' : '#34c759';
}

export function scoreBg(score: string): string {
  return score === 'red'
    ? 'rgba(255,59,48,0.06)'
    : score === 'yellow'
      ? 'rgba(255,149,0,0.06)'
      : 'rgba(52,199,89,0.06)';
}

export function scoreToGrade(score: string): string {
  return score === 'green' ? 'A' : score === 'yellow' ? 'C' : 'F';
}

export function scoreToVerdict(score: string): string {
  return score === 'green'
    ? 'This codebase is in good shape.'
    : score === 'yellow'
      ? 'Some areas need attention before production.'
      : 'Critical issues require immediate action.';
}
