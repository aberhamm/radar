/**
 * Webhook notification — fire-and-forget POST for Slack/Teams integration.
 *
 * - 5s timeout
 * - Validates URL against domainBlocklist before sending
 * - Never throws — logs and returns
 */

import { isDomainBlocked } from '../tools/web/domainBlocklist.js';
import { ciLog } from './utils.js';

export interface WebhookPayload {
  repo: string;
  score: string;
  findings: number;
  newFindings: number;
  resolvedFindings: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export async function sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
  // SSRF validation
  const blocked = isDomainBlocked(url);
  if (blocked) {
    ciLog(`Webhook blocked: ${blocked}`);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Radar CI: ${payload.score.toUpperCase()} — ${payload.findings} findings (${payload.newFindings} new, ${payload.resolvedFindings} resolved) on ${payload.repo}`,
        ...payload,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    ciLog('Webhook sent successfully');
  } catch (err) {
    const msg = (err as Error).name === 'AbortError'
      ? 'Webhook timed out (5s)'
      : `Webhook failed: ${(err as Error).message}`;
    ciLog(msg);
  }
}
