import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Score helpers (shared across dashboard components) ─────────

export type ScoreLevel = 'red' | 'yellow' | 'green';

export function scoreColor(score: string): string {
  return score === 'red' ? 'var(--color-danger)' : score === 'yellow' ? 'var(--color-warning)' : 'var(--color-success)';
}

export function scoreBg(score: string): string {
  return score === 'red'
    ? 'color-mix(in srgb, var(--color-danger) 6%, transparent)'
    : score === 'yellow'
      ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)'
      : 'color-mix(in srgb, var(--color-success) 6%, transparent)';
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
