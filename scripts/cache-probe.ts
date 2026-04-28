/**
 * Cache Probe: verify prompt caching through Portkey → Bedrock.
 *
 * Aligned with Portkey's canonical request format:
 *   - Provider route baked into model ID: @route/model-id
 *   - Single auth header: x-portkey-api-key
 *   - System prompt as {"role":"system"} in messages array
 *
 * Runs three test phases:
 *   Phase 1 — Canonical raw fetch (baseline, no caching directives)
 *   Phase 2 — Raw fetch with x-portkey-cache: simple (Portkey-level cache)
 *   Phase 3 — Pi Agent with matched config
 *
 * Run: pnpm run spike:cache
 * Requires: .env with LLM_API_KEY (or PORTKEY_API_KEY), LLM_BASE_URL (or PORTKEY_BASE_URL),
 *           AGENT_MODEL (optionally prefixed with provider route)
 */

import 'dotenv/config';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Model, AgentEvent } from '@mariozechner/pi-ai';

console.log('=== Prompt Cache Probe ===\n');

// ── Resolve env vars (prefer generic names, fall back to Portkey-specific) ──

const apiKey = process.env.LLM_API_KEY ?? process.env.PORTKEY_API_KEY;
const baseUrl = process.env.LLM_BASE_URL ?? process.env.PORTKEY_BASE_URL;
const providerRoute = process.env.LLM_PROVIDER_ROUTE ?? process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';
const rawAgentModel = 'us.anthropic.claude-opus-4-7';

if (!apiKey || !baseUrl) {
  console.error('ERROR: LLM_API_KEY/PORTKEY_API_KEY and LLM_BASE_URL/PORTKEY_BASE_URL must be set in .env');
  process.exit(1);
}

// Canonical model ID: if it doesn't already include a route prefix, prepend it
const fullModelId = rawAgentModel.startsWith('@')
  ? rawAgentModel
  : `${providerRoute}/${rawAgentModel}`;

console.log(`Base URL:       ${baseUrl}`);
console.log(`Full model ID:  ${fullModelId}`);
console.log(`Raw model ID:   ${rawAgentModel}`);
console.log(`Provider route: ${providerRoute}`);

// ── Shared system prompt (large enough for caching to matter) ──

const SYSTEM_PROMPT = [
  'You are a test assistant for cache verification.',
  'Respond with exactly one short sentence. Do not use tools.',
  '',
  '## Filler (to make the system prompt large enough for caching to matter)',
  ...Array.from({ length: 60 }, (_, i) =>
    `Rule ${i + 1}: This is padding rule number ${i + 1} to ensure the system prompt exceeds the minimum cacheable prefix size. ` +
    `It contains enough text that the provider will consider it worth caching across turns.`,
  ),
].join('\n');

console.log(`System prompt:  ~${SYSTEM_PROMPT.length} chars\n`);

// ── Helpers ──

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  [key: string]: unknown;
}

async function rawChat(
  messages: { role: string; content: string }[],
  turnLabel: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ usage: RawUsage; assistantContent: string; cacheStatus: string | null }> {
  console.log(`── ${turnLabel} ──`);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-portkey-api-key': apiKey,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: fullModelId,
      max_tokens: 256,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const usage = (json.usage ?? {}) as RawUsage;

  console.log('  usage:', JSON.stringify(usage, null, 2));

  const cacheStatus = res.headers.get('x-portkey-cache-status');
  if (cacheStatus) console.log(`  x-portkey-cache-status: ${cacheStatus}`);

  // Log any anthropic-specific fields
  const anthropicKeys = Object.keys(usage).filter(
    (k) => k.includes('cache') || k.includes('Cache'),
  );
  if (anthropicKeys.length > 0) {
    console.log('  Cache-specific fields:', anthropicKeys.map((k) => `${k}=${usage[k]}`).join(', '));
  }

  const assistantContent =
    ((json.choices as { message: { content: string } }[])?.[0]?.message?.content) ?? '';
  console.log(`  response: "${assistantContent.slice(0, 80)}"`);
  console.log('');

  return { usage, assistantContent, cacheStatus };
}

function printPhaseSummary(
  label: string,
  results: { usage: RawUsage; cacheStatus: string | null }[],
) {
  console.log(`── ${label} Summary ──`);
  console.log('Turn │ Prompt │ Completion │ cached_tokens │ cache_read │ cache_create │ Cache-Status');
  console.log('─────┼────────┼────────────┼───────────────┼────────────┼──────────────┼─────────────');
  results.forEach((r, i) => {
    const u = r.usage;
    const cached = u.prompt_tokens_details?.cached_tokens ?? '-';
    const cacheRead = u.cache_read_input_tokens ?? '-';
    const cacheCreate = u.cache_creation_input_tokens ?? '-';
    console.log(
      `  ${i + 1}  │ ${String(u.prompt_tokens ?? '-').padStart(6)} │ ${String(u.completion_tokens ?? '-').padStart(10)} │ ${String(cached).padStart(13)} │ ${String(cacheRead).padStart(10)} │ ${String(cacheCreate).padStart(12)} │ ${r.cacheStatus ?? 'n/a'}`,
    );
  });
  console.log('');
}

/* ══════════════════════════════════════════════════════════════
 * PHASE 1: Canonical raw fetch — baseline, no caching directives
 * ══════════════════════════════════════════════════════════════ */

console.log('═══════════════════════════════════════════');
console.log(' PHASE 1: Canonical raw fetch (no cache directives)');
console.log('═══════════════════════════════════════════\n');

const phase1Results: { usage: RawUsage; cacheStatus: string | null }[] = [];

try {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  messages.push({ role: 'user', content: 'What is 2 + 2?' });
  const r1 = await rawChat([...messages], 'Phase 1 Turn 1');
  messages.push({ role: 'assistant', content: r1.assistantContent });
  phase1Results.push(r1);

  messages.push({ role: 'user', content: 'What is 3 + 3?' });
  const r2 = await rawChat([...messages], 'Phase 1 Turn 2');
  messages.push({ role: 'assistant', content: r2.assistantContent });
  phase1Results.push(r2);

  messages.push({ role: 'user', content: 'What is 4 + 4?' });
  const r3 = await rawChat([...messages], 'Phase 1 Turn 3');
  phase1Results.push(r3);

  printPhaseSummary('Phase 1 (no cache)', phase1Results);
} catch (err) {
  console.error(`✗ Phase 1 ERROR: ${(err as Error).message}\n`);
}

/* ══════════════════════════════════════════════════════════════
 * PHASE 2: Raw fetch with x-portkey-cache: simple
 * ══════════════════════════════════════════════════════════════ */

console.log('═══════════════════════════════════════════');
console.log(' PHASE 2: Raw fetch with x-portkey-cache: simple');
console.log('═══════════════════════════════════════════\n');

const phase2Results: { usage: RawUsage; cacheStatus: string | null }[] = [];

try {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  const cacheHeaders = { 'x-portkey-cache': 'simple' };

  messages.push({ role: 'user', content: 'What is 2 + 2?' });
  const r1 = await rawChat([...messages], 'Phase 2 Turn 1 (cache miss expected)', cacheHeaders);
  messages.push({ role: 'assistant', content: r1.assistantContent });
  phase2Results.push(r1);

  // Same conversation state → should hit Portkey's semantic cache
  const r2 = await rawChat([...messages.slice(0, -1), ...messages.slice(-1)], 'Phase 2 Turn 1 replay (cache hit expected)', cacheHeaders);
  phase2Results.push(r2);

  messages.push({ role: 'user', content: 'What is 3 + 3?' });
  const r3 = await rawChat([...messages], 'Phase 2 Turn 2 (cache miss expected)', cacheHeaders);
  phase2Results.push(r3);

  printPhaseSummary('Phase 2 (portkey cache)', phase2Results);
} catch (err) {
  console.error(`✗ Phase 2 ERROR: ${(err as Error).message}\n`);
}

/* ══════════════════════════════════════════════════════════════
 * PHASE 3: Pi Agent with canonical model format
 * ══════════════════════════════════════════════════════════════ */

console.log('═══════════════════════════════════════════');
console.log(' PHASE 3: Pi Agent (canonical model format)');
console.log('═══════════════════════════════════════════\n');

const piModel: Model<'openai-completions'> = {
  id: fullModelId,
  name: `${fullModelId} via Portkey`,
  api: 'openai-completions',
  provider: 'portkey',
  baseUrl: baseUrl,
  headers: {
    'x-portkey-api-key': apiKey,
  },
  reasoning: false,
  input: ['text'],
  cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 256,
};

interface UsageSnapshot {
  turn: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  rawUsage: unknown;
}

const snapshots: UsageSnapshot[] = [];
let turnCounter = 0;

const agent = new Agent({
  initialState: {
    systemPrompt: SYSTEM_PROMPT,
    model: piModel,
    thinkingLevel: 'off',
    tools: [],
  },
  toolExecution: 'sequential',
  getApiKey: async () => apiKey,
  onPayload: (payload: Record<string, unknown>) => {
    if (!payload || typeof payload !== 'object') return undefined;
    if (Array.isArray(payload.messages) && (payload.messages as unknown[]).length > 0) {
      if (typeof payload.system === 'string') {
        payload.system = [{ type: 'text', text: payload.system, cache_control: { type: 'ephemeral' } }];
      } else if (Array.isArray(payload.system) && (payload.system as unknown[]).length > 0) {
        const arr = payload.system as Record<string, unknown>[];
        const last = arr[arr.length - 1];
        if (last && typeof last === 'object') {
          last.cache_control = { type: 'ephemeral' };
        }
      }
    }
    return payload;
  },
});

agent.subscribe((event: AgentEvent) => {
  if (event.type !== 'message_end') return;
  const msg = event.message;
  if (!msg || !('role' in msg) || msg.role !== 'assistant') return;

  turnCounter++;
  const u = msg.usage;
  snapshots.push({
    turn: turnCounter,
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite ?? 0,
    totalTokens: u.totalTokens,
    rawUsage: u,
  });
});

try {
  console.log('── Pi Turn 1 ──');
  await agent.prompt('What is 2 + 2?');
  console.log('── Pi Turn 2 ──');
  await agent.prompt('What is 3 + 3?');
  console.log('── Pi Turn 3 ──');
  await agent.prompt('What is 4 + 4?');

  console.log('\n── Pi Phase Summary ──');
  console.log('Turn │ Input │ Output │ CacheRead │ CacheWrite │ Total');
  console.log('─────┼───────┼────────┼───────────┼────────────┼──────');
  for (const s of snapshots) {
    console.log(
      `  ${s.turn}  │ ${String(s.input).padStart(5)} │ ${String(s.output).padStart(6)} │ ${String(s.cacheRead).padStart(9)} │ ${String(s.cacheWrite).padStart(10)} │ ${String(s.totalTokens).padStart(5)}`,
    );
  }

  console.log('\n── Pi Raw usage objects ──');
  for (const s of snapshots) {
    console.log(`Turn ${s.turn}:`, JSON.stringify(s.rawUsage, null, 2));
  }
} catch (err) {
  console.error(`✗ Pi Agent ERROR: ${(err as Error).message}`);
}

/* ══════════════════════════════════════════════════════════════
 * VERDICT
 * ══════════════════════════════════════════════════════════════ */

console.log('\n═══════════════════════════════════════════');
console.log(' VERDICT');
console.log('═══════════════════════════════════════════\n');

// Check phase 1 for native Anthropic cache fields
const phase1HasCache = phase1Results.some(
  (r) =>
    (r.usage.prompt_tokens_details?.cached_tokens ?? 0) > 0 ||
    (r.usage.cache_read_input_tokens ?? 0) > 0,
);

// Check phase 2 for Portkey cache hits
const phase2HasHit = phase2Results.some((r) => r.cacheStatus === 'HIT');

// Check phase 3 for Pi visibility
const piHasCache = snapshots.some((s) => s.cacheRead > 0 || s.cacheWrite > 0);

console.log(`Phase 1 (Anthropic prompt caching via Bedrock):  ${phase1HasCache ? '✓ WORKING' : '✗ Not visible'}`);
console.log(`Phase 2 (Portkey semantic cache):                ${phase2HasHit ? '✓ HIT' : '✗ No hits'}`);
console.log(`Phase 3 (Pi Agent visibility):                   ${piHasCache ? '✓ WORKING' : '✗ Not visible'}`);

console.log('');
if (phase1HasCache && piHasCache) {
  console.log('Full pipeline working. No changes needed.');
} else if (phase1HasCache && !piHasCache) {
  console.log('Portkey returns cache data but Pi drops it.');
  console.log('Fix: patch Pi\'s openai-completions parser or extract in afterToolCall.');
} else if (phase2HasHit) {
  console.log('Portkey semantic cache works. Consider using x-portkey-cache: simple');
  console.log('in production headers for gateway-level caching.');
} else {
  console.log('Neither Anthropic prompt caching nor Portkey semantic caching produced hits.');
  console.log('');
  console.log('Likely causes:');
  console.log('  1. Portkey gateway may strip cache_control before forwarding to Bedrock');
  console.log('  2. Portkey semantic cache may need to be enabled on the gateway instance');
  console.log('  3. Bedrock may not support prompt caching for this model/region');
  console.log('');
  console.log('Next steps:');
  console.log('  - Ask your Portkey admin whether prompt caching passthrough is enabled');
  console.log('  - Check Portkey dashboard for raw Bedrock response bodies');
  console.log('  - Test with direct Anthropic API (bypass Portkey + Bedrock) as control');
}

console.log('\n=== Cache probe complete ===');
