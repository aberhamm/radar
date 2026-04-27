import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEvents, loadRunEnvelope, loadRunFindings } from '@/lib/agentSession';

/**
 * GET /api/history/group/[parentId]
 *
 * Load all child runs of a multi-goal group by parentRunId.
 * Returns scorecards for all 8 goals + the shared event stream.
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

  // Load each child's scorecard
  const goals: Array<{
    id: string;
    goal: string;
    scorecard: unknown;
    metrics: unknown;
    briefMarkdown: string;
    findingsCount: number;
  }> = [];

  const goalResults = await Promise.all(children.map(async (child) => {
    if (child.result) {
      return {
        id: child.id,
        goal: child.goal,
        scorecard: child.result.scorecard,
        metrics: child.result.metrics,
        briefMarkdown: child.result.briefMarkdown ?? '',
        findingsCount: (child.result.state?.findings as unknown[])?.length ?? 0,
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
        findingsCount: envelope.findingsSummary?.length ?? 0,
      };
    }
    return null;
  }));
  for (const g of goalResults) { if (g) goals.push(g); }

  // Load events from the first child (all children share the same event stream)
  const events = loadRunEvents(children[0]);

  // Load findings from the last child (accumulated across all passes)
  const findings = children[children.length - 1].result?.state?.findings
    ?? loadRunFindings(children[children.length - 1]);

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
    events,
    findings,
    totalFindings: (findings as unknown[])?.length ?? 0,
  });
}
