/**
 * Stub provider — throws for any provider not yet implemented.
 * Keeps the interface real while making "add Copilot/Codex later" trivial.
 */

import type { ModelProvider, ChatCompletionResponse, ChatMessage, ToolDefinition } from '../types/provider.js';

export class StubProvider implements ModelProvider {
  readonly name: string;

  constructor(providerName: string) {
    this.name = providerName;
  }

  async chat(
    _messages: ChatMessage[],
    _options?: { tools?: ToolDefinition[]; model?: string; temperature?: number; maxTokens?: number },
  ): Promise<ChatCompletionResponse> {
    throw new Error(
      `Provider not implemented: ${this.name}. See docs for setup.`,
    );
  }
}
