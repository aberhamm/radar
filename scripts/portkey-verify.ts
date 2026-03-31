/**
 * Chunk 0 Spike: Portkey + Bedrock Verification
 *
 * Verifies:
 * 1. Portkey SDK connects to Bedrock via gateway
 * 2. Sonnet 4.6 model ID works
 * 3. Haiku 4.5 model ID works
 * 4. Tool calling works (simple tool definition + response)
 * 5. Usage object returns token counts
 * 6. Whether cache token fields are surfaced
 */

import 'dotenv/config';
import { createProvider } from '../providers/factory.js';
import type { ToolDefinition } from '../types/provider.js';

const SONNET_MODEL = 'us.anthropic.claude-sonnet-4-6';
const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

async function verify() {
  console.log('=== Chunk 0: Portkey + Bedrock Verification ===\n');

  // Step 1: Create provider
  console.log('1. Creating Portkey provider...');
  const provider = createProvider({ type: 'portkey' });
  console.log(`   Provider: ${provider.name}`);
  console.log(`   Base URL: ${process.env.PORTKEY_BASE_URL ?? '(default)'}`);
  console.log(`   Bedrock provider: ${process.env.PORTKEY_PROVIDER ?? '(none)'}\n`);

  // Step 2: Test Sonnet 4.6
  console.log(`2. Testing Sonnet 4.6 (${SONNET_MODEL})...`);
  try {
    const sonnetResponse = await provider.chat(
      [{ role: 'user', content: 'Reply with exactly: "Sonnet 4.6 operational"' }],
      { model: SONNET_MODEL, maxTokens: 50, temperature: 0 },
    );
    console.log(`   Response: ${sonnetResponse.content}`);
    console.log(`   Model returned: ${sonnetResponse.model}`);
    console.log(`   Tokens: prompt=${sonnetResponse.usage.promptTokens}, completion=${sonnetResponse.usage.completionTokens}`);
    console.log(`   Finish reason: ${sonnetResponse.finishReason}`);
    console.log('   PASS\n');
  } catch (e) {
    console.error(`   FAIL: ${e instanceof Error ? e.message : e}\n`);
  }

  // Step 3: Test Haiku 4.5
  console.log(`3. Testing Haiku 4.5 (${HAIKU_MODEL})...`);
  try {
    const haikuResponse = await provider.chat(
      [{ role: 'user', content: 'Reply with exactly: "Haiku 4.5 operational"' }],
      { model: HAIKU_MODEL, maxTokens: 50, temperature: 0 },
    );
    console.log(`   Response: ${haikuResponse.content}`);
    console.log(`   Model returned: ${haikuResponse.model}`);
    console.log(`   Tokens: prompt=${haikuResponse.usage.promptTokens}, completion=${haikuResponse.usage.completionTokens}`);
    console.log('   PASS\n');
  } catch (e) {
    console.error(`   FAIL: ${e instanceof Error ? e.message : e}\n`);
  }

  // Step 4: Test tool calling
  console.log('4. Testing tool calling...');
  const testTool: ToolDefinition = {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  };

  try {
    const toolResponse = await provider.chat(
      [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      { model: SONNET_MODEL, tools: [testTool], maxTokens: 200, temperature: 0 },
    );
    console.log(`   Finish reason: ${toolResponse.finishReason}`);
    console.log(`   Tool calls: ${toolResponse.toolCalls.length}`);
    if (toolResponse.toolCalls.length > 0) {
      const tc = toolResponse.toolCalls[0];
      console.log(`   Tool: ${tc.function.name}`);
      console.log(`   Args: ${tc.function.arguments}`);
    }
    console.log('   PASS\n');
  } catch (e) {
    console.error(`   FAIL: ${e instanceof Error ? e.message : e}\n`);
  }

  // Step 5: Check usage object in detail
  console.log('5. Checking usage object for cache token fields...');
  try {
    const msgs = [{ role: 'user' as const, content: 'Say "cache test"' }];
    const response = await provider.chat(msgs, {
      model: SONNET_MODEL,
      maxTokens: 20,
      temperature: 0,
    });
    // Log the raw usage to see all fields
    console.log(`   Parsed usage: ${JSON.stringify(response.usage)}`);
    if (response.usage.cachedTokens && response.usage.cachedTokens > 0) {
      console.log('   Cache tokens ARE surfaced by Portkey');
    } else {
      console.log('   Cache tokens: 0 (not surfaced or no caching occurred)');
      console.log('   RunMetrics.cachedTokens will default to 0');
    }
    console.log('   DONE\n');
  } catch (e) {
    console.error(`   FAIL: ${e instanceof Error ? e.message : e}\n`);
  }

  console.log('=== Verification complete ===');
}

verify().catch(console.error);
