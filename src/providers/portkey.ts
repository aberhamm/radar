/**
 * Portkey provider — routes to Amazon Bedrock via Portkey AI gateway.
 * Uses OpenAI-compatible API surface from portkey-ai SDK.
 *
 * Gateway setup: Portkey at portkeygateway.perficient.com routes to
 * AWS Bedrock via x-portkey-provider header. No virtual key needed.
 */

import { Portkey } from 'portkey-ai';
import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionResponse,
  ToolDefinition,
  ToolCall,
} from '../types/provider.js';

const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6';

export interface PortkeyConfig {
  apiKey: string;
  baseUrl?: string;
  provider?: string;
}

export class PortkeyProvider implements ModelProvider {
  readonly name = 'portkey';
  private client: InstanceType<typeof Portkey>;

  constructor(config: PortkeyConfig) {
    this.client = new Portkey({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      provider: config.provider,
    });
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<ChatCompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      })),
      ...(options?.tools ? { tools: options.tools } : {}),
      ...(options?.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });

    const choice = response.choices[0];
    const message = choice.message!;
    const toolCalls: ToolCall[] =
      (message.tool_calls as ToolCall[] | undefined) ?? [];

    const content = typeof message.content === 'string' ? message.content : null;

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        cachedTokens:
          (response.usage as Record<string, number> | undefined)?.[
            'cache_read_input_tokens'
          ] ?? 0,
      },
      model: response.model ?? options?.model ?? DEFAULT_MODEL,
      finishReason: choice.finish_reason as ChatCompletionResponse['finishReason'],
    };
  }
}
