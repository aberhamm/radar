/**
 * Spike: Pi Agent + Portkey Gateway Verification
 *
 * Verifies:
 * 1. Pi Agent can be imported and constructed
 * 2. Pi Model config works with Portkey gateway (custom baseUrl + headers)
 * 3. Tool calling works through Pi's AgentTool format
 * 4. Events stream correctly (agent_start, tool_execution_*, agent_end)
 * 5. Token usage is returned
 *
 * Run: pnpm run spike:pi
 * Requires: .env with PORTKEY_API_KEY, PORTKEY_BASE_URL, PORTKEY_PROVIDER, AGENT_MODEL
 */

import 'dotenv/config';
import { Agent } from '@mariozechner/pi-agent-core';
import { Type } from '@mariozechner/pi-ai';
import type { Model, AgentTool } from '@mariozechner/pi-ai';

console.log('=== Pi Agent + Portkey Gateway Spike ===\n');

// Step 1: Build Pi Model config pointing at Portkey
console.log('1. Building Pi Model config for Portkey gateway...');

const apiKey = process.env.PORTKEY_API_KEY;
const baseUrl = process.env.PORTKEY_BASE_URL;
const provider = process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';
const modelId = process.env.AGENT_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

if (!apiKey || !baseUrl) {
  console.error('   ERROR: PORTKEY_API_KEY and PORTKEY_BASE_URL must be set in .env');
  process.exit(1);
}

const piModel: Model<'openai-completions'> = {
  id: modelId,
  name: `${modelId} via Portkey`,
  api: 'openai-completions',
  provider: 'portkey',
  baseUrl,
  headers: {
    'x-portkey-api-key': apiKey,
    'x-portkey-provider': provider,
  },
  reasoning: false,
  input: ['text'],
  cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

console.log(`   Model: ${piModel.id}`);
console.log(`   Base URL: ${piModel.baseUrl}`);
console.log(`   Provider header: ${piModel.headers?.['x-portkey-provider']}`);

// Step 2: Define a simple test tool
console.log('\n2. Defining test tool...');

const greetTool: AgentTool = {
  name: 'greet',
  label: 'Greet',
  description: 'Returns a greeting for the given name',
  parameters: Type.Object({
    name: Type.String({ description: 'Name to greet' }),
  }),
  execute: async (_toolCallId, params) => {
    console.log(`   [tool executed] greet("${params.name}")`);
    return {
      content: [{ type: 'text', text: `Hello, ${params.name}! Welcome to the Pi spike test.` }],
      details: { greeted: params.name },
    };
  },
};
console.log('   Tool "greet" defined with TypeBox schema');

// Step 3: Create Pi Agent and run
console.log('\n3. Creating Pi Agent and running prompt...');

const events: string[] = [];

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a test assistant. When asked to greet someone, use the greet tool. After the tool returns, respond with a brief confirmation.',
    model: piModel,
    thinkingLevel: 'off',
    tools: [greetTool],
  },
  toolExecution: 'sequential',
  // Portkey expects API key as Bearer token in Authorization header
  getApiKey: async () => apiKey,
});

agent.subscribe((event) => {
  events.push(event.type);
  switch (event.type) {
    case 'agent_start':
      console.log('   [event] agent_start');
      break;
    case 'tool_execution_start':
      console.log(`   [event] tool_execution_start: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case 'tool_execution_end':
      console.log(`   [event] tool_execution_end: ${event.toolName} (error: ${event.isError})`);
      break;
    case 'message_end': {
      const msg = event.message;
      if (msg && 'role' in msg && msg.role === 'assistant') {
        console.log(`   [event] message_end: assistant (stop: ${msg.stopReason}, tokens: ${msg.usage.input}in/${msg.usage.output}out)`);
      }
      break;
    }
    case 'agent_end':
      console.log(`   [event] agent_end (${event.messages.length} messages)`);
      break;
  }
});

try {
  await agent.prompt('Please greet "Matthew" using the greet tool.');

  console.log('\n4. Results:');
  console.log(`   Events received: ${events.join(', ')}`);

  // Check expected events
  const hasAgentStart = events.includes('agent_start');
  const hasToolExec = events.includes('tool_execution_start');
  const hasAgentEnd = events.includes('agent_end');

  console.log(`   agent_start: ${hasAgentStart ? '✓' : '✗'}`);
  console.log(`   tool_execution_start: ${hasToolExec ? '✓' : '✗'}`);
  console.log(`   agent_end: ${hasAgentEnd ? '✓' : '✗'}`);

  // Check token usage from state messages
  const messages = agent.state.messages;
  const assistantMessages = messages.filter(
    (m): m is Extract<typeof m, { role: 'assistant' }> => 'role' in m && m.role === 'assistant'
  );
  const totalInput = assistantMessages.reduce((s, m) => s + m.usage.input, 0);
  const totalOutput = assistantMessages.reduce((s, m) => s + m.usage.output, 0);
  console.log(`   Total tokens: ${totalInput} input, ${totalOutput} output`);

  const allPass = hasAgentStart && hasToolExec && hasAgentEnd;
  console.log(`\n${allPass ? '✓ ALL CHECKS PASS' : '✗ SOME CHECKS FAILED'}`);

  if (!allPass) process.exit(1);
} catch (err) {
  console.error(`\n✗ ERROR: ${(err as Error).message}`);
  console.error((err as Error).stack);
  process.exit(1);
}

console.log('\n=== Pi spike complete ===');
