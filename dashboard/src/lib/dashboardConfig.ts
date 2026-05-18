import defaults from './dashboardConfig.json';
import type { SpecialistDisplayMode } from './useSpecialistDisplayMode';

export interface DashboardConfig {
  specialistDisplay: SpecialistDisplayMode;
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  verbose: boolean;
}

export const config: DashboardConfig = defaults as DashboardConfig;
