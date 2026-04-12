/**
 * Backward-compatible re-export from providerConfig.
 * All provider configuration now lives in providerConfig.ts.
 */
export { getPortkeyConfig, getProviderConfig } from './providerConfig.js';
export type { PortkeyConfig, ProviderConfig, ProviderType, ProviderOverrides } from './providerConfig.js';
