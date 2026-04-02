import { NextRequest } from 'next/server';
import { getSession, sendStreamEvent } from '@/lib/agentSession';

export async function GET(_req: NextRequest) {
  const session = getSession();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const run = session.currentRun;
      if (run) {
        // Replay accumulated events for reconnects
        for (const event of run.events) {
          sendStreamEvent(controller, event);
        }
        // Register for new events
        run.streamController = controller;
      }

      // If run is already complete, send completion and close
      if (session.status === 'complete' && session.result) {
        sendStreamEvent(controller, {
          type: 'run_complete', result: { scorecard: session.result.scorecard, metrics: session.result.metrics },
        });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      const run = session.currentRun;
      if (run && run.streamController) {
        run.streamController = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
