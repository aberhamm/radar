/**
 * Goal types and constants — local to the dashboard.
 *
 * Duplicated from @agent/types/state to avoid webpack traversing the
 * agent source tree (which uses import.meta.dirname in transitive deps).
 * Keep in sync with src/types/state.ts.
 */

export type GoalType =
  | 'onboarding' | 'audit' | 'audit-generic' | 'migration'
  | 'component-map' | 'ci-check' | 'security-review'
  | 'nextjs' | 'accessibility' | 'performance';

export const ALL_GOALS: GoalType[] = [
  'onboarding', 'audit', 'audit-generic', 'migration', 'component-map',
  'ci-check', 'security-review', 'nextjs', 'accessibility', 'performance',
];
