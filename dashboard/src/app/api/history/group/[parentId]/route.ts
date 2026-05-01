import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEvents, loadRunEnvelope, loadRunFindings, loadRunData } from '@/lib/agentSession';

/**
 * GET /api/history/group/[parentId]
 *
 * Load all child runs of a multi-goal group by parentRunId.
 * Returns scorecards for all goals + pre-computed rundata (not raw events).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ parentId: string }> },
) {
  const { parentId } = await params;
  const session = getSession();

  // Find all children with this parentRunId
  const children = session.history.filter(r => r.parentRunId === parentId);

  if (children.length === 0) {
    return NextResponse.json({ error: 'Multi-goal group not found' }, { status: 404 });
  }

  // Load each child's scorecard + findings
  const goals: Array<{
    id: string;
    goal: string;
    scorecard: unknown;
    metrics: unknown;
    briefMarkdown: string;
    findingsCount: number;
    findings: unknown[];
  }> = [];

  const goalResults = await Promise.all(children.map(async (child) => {
    const childFindings = (child.result?.state?.findings as unknown[]) ?? loadRunFindings(child) ?? [];
    if (child.result) {
      return {
        id: child.id,
        goal: child.goal,
        scorecard: child.result.scorecard,
        metrics: child.result.metrics,
        briefMarkdown: child.result.briefMarkdown ?? '',
        findingsCount: childFindings.length,
        findings: childFindings,
      };
    }
    const envelope = loadRunEnvelope(child);
    if (envelope) {
      return {
        id: child.id,
        goal: child.goal,
        scorecard: envelope.scorecard,
        metrics: envelope.metrics,
        briefMarkdown: envelope.briefMarkdown ?? '',
        findingsCount: childFindings.length,
        findings: childFindings,
      };
    }
    return null;
  }));
  for (const g of goalResults) { if (g) goals.push(g); }

  // Pre-computed rundata (small) instead of raw events (1MB+)
  const rundata = loadRunData(children[0]);

  // Extract pass summary from events for PassBreakdown component
  // Only reads pass_boundary + pass_complete events, not full stream
  const events = loadRunEvents(children[0]);
  const passSummary: Array<{ name: string; eventCount: number; budget?: number; terminationReason?: string }> = [];
  const completions = new Map<string, { toolCalls: number; budget: number; terminationReason: string }>();
  for (const ev of events) {
    if (ev.action === 'pass_complete' && ev.result) {
      try {
        const data = JSON.parse(ev.result as string);
        completions.set(data.pass, data);
      } catch { /* ignore */ }
    }
  }
  let currentPass = 'Core';
  let currentCount = 0;
  for (const ev of events) {
    if (ev.action === 'pass_boundary') {
      const completion = completions.get(currentPass);
      passSummary.push({
        name: currentPass,
        eventCount: completion?.toolCalls ?? currentCount,
        budget: completion?.budget,
        terminationReason: completion?.terminationReason,
      });
      currentPass = (ev.result as string) ?? 'Next pass';
      currentCount = 0;
    } else if (ev.type === 'tool_call') {
      currentCount++;
    }
  }
  const lastCompletion = completions.get(currentPass);
  passSummary.push({
    name: currentPass,
    eventCount: lastCompletion?.toolCalls ?? currentCount,
    budget: lastCompletion?.budget,
    terminationReason: lastCompletion?.terminationReason,
  });
  const toolCallCount = events.filter(e => e.type === 'tool_call').length;

  // Deduplicate findings across all child goals (each child stores the full set
  // from the pass that generated it, so any non-null child has the complete list)
  const findings = goalResults.find(g => g && (g.findings as unknown[])?.length > 0)?.findings ?? [];

  // Aggregate metrics
  const firstChild = children[0];
  const repoName = firstChild.repoName;
  const repoUrl = firstChild.repoUrl;
  const startedAt = firstChild.startedAt;
  const completedAt = children[children.length - 1].completedAt ?? firstChild.completedAt;

  return NextResponse.json({
    parentId,
    repoName,
    repoUrl,
    startedAt,
    completedAt,
    goals,
    rundata,
    passSummary,
    toolCallCount,
    findings,
    totalFindings: (findings as unknown[])?.length ?? 0,
  });
}
