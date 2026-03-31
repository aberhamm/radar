/**
 * Model provider abstraction — enables swapping between Portkey, future providers.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  model: string;
  finishReason: 'stop' | 'end_turn' | 'tool_calls' | 'tool_use' | 'length' | 'content_filter';
}

export interface ModelProvider {
  /** Send a chat completion request. */
  chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<ChatCompletionResponse>;

  /** Provider name for logging. */
  readonly name: string;
}
