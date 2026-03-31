/**
 * Provider factory — creates the right ModelProvider based on config/env.
 */

import type { ModelProvider } from '../types/provider.js';
import { PortkeyProvider } from './portkey.js';
import { StubProvider } from './stub.js';

export interface ProviderConfig {
  type: string;
  apiKey?: string;
  baseUrl?: string;
  provider?: string;
}

/**
 * Create a ModelProvider from config. Reads from env if keys not provided.
 * Any provider type other than "portkey" gets a StubProvider.
 */
export function createProvider(config?: Partial<ProviderConfig>): ModelProvider {
  const providerType = config?.type ?? process.env.PROVIDER_TYPE ?? 'portkey';

  if (providerType === 'portkey') {
    const apiKey = config?.apiKey ?? process.env.PORTKEY_API_KEY;
    const baseUrl = config?.baseUrl ?? process.env.PORTKEY_BASE_URL;
    const provider = config?.provider ?? process.env.PORTKEY_PROVIDER;

    if (!apiKey) {
      throw new Error(
        'Portkey provider requires PORTKEY_API_KEY. Set it in .env or pass via config.',
      );
    }

    return new PortkeyProvider({
      apiKey,
      baseUrl,
      provider,
    });
  }

  return new StubProvider(providerType);
}
