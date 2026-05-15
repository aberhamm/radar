import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEnvelope, loadRunFindings, findRunById } from '@/lib/agentSession';
import demoRun from '@/fixtures/demo-run.json';
import demoMultigoal from '@/fixtures/demo-run-multigoal.json';

const DEMO_RUNS: Record<string, typeof demoRun> = {
  [demoRun.id]: demoRun,
  [demoMultigoal.id]: demoMultigoal as typeof demoRun,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slim = req.nextUrl.searchParams.get('slim') === '1';

  const demo = DEMO_RUNS[id];
  if (demo) {
    const findings = slim
      ? demo.result.state.findings.map(f => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          evidenceFiles: f.evidence.map(e => e.filePath),
          tags: f.tags,
        }))
      : demo.result.state.findings;
    return NextResponse.json({
      id: demo.id,
      goal: demo.goal,
      repoName: demo.repoName,
      startedAt: demo.startedAt,
      completedAt: demo.completedAt,
      specialists: (demo as typeof demoMultigoal).specialists ?? null,
      result: {
        scorecard: demo.result.scorecard,
        metrics: demo.result.metrics,
        terminationReason: demo.result.terminationReason,
        briefMarkdown: demo.result.briefMarkdown,
        state: { findings },
      },
    });
  }

  const session = getSession();
  let record = session.history.find(r => r.id === id);

  // Fallback: look up from disk index (survives HMR / session loss)
  if (!record) {
    record = findRunById(id) ?? undefined;
  }

  if (!record) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const cacheHeaders: HeadersInit = record.completedAt
    ? { 'Cache-Control': 'public, max-age=86400, immutable' }
    : { 'Cache-Control': 'no-cache' };

  // Current/just-completed run: result is still in memory
  if (record.result) {
    const fullFindings = record.result.state?.findings ?? [];
    // Slim mode: return lightweight finding stubs (enough for counts/display)
    // instead of empty array. Full evidence bodies load via /findings endpoint.
    const slimFindings = slim
      ? (fullFindings as Array<Record<string, unknown>>).map(f => ({
          id: f.id ?? '',
          severity: f.severity ?? 'info',
          category: f.category ?? '',
          title: f.title ?? '',
          evidenceFiles: ((f.evidence as Array<{ filePath?: string }>) ?? []).map(e => e.filePath ?? ''),
          tags: (f.tags as string[]) ?? [],
        }))
      : fullFindings;
    return NextResponse.json({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      repoUrl: record.repoUrl,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: {
        scorecard: record.result.scorecard,
        metrics: record.result.metrics,
        terminationReason: record.result.terminationReason,
        briefMarkdown: record.result.briefMarkdown,
        state: { findings: slimFindings },
      },
    }, { headers: cacheHeaders });
  }

  // Historical run: load from tiered storage (Tier 2 + 3)
  const envelope = loadRunEnvelope(record);
  if (!envelope) {
    // Record exists but envelope not on disk yet (in-progress or HMR wiped memory).
    // Return metadata so the UI can render; findings/events load via their own routes.
    return NextResponse.json({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      repoUrl: record.repoUrl,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: {
        scorecard: null,
        metrics: null,
        terminationReason: null,
        briefMarkdown: null,
        state: { findings: slim ? [] : loadRunFindings(record) },
      },
    }, { headers: cacheHeaders });
  }

  // Slim mode: use findingsSummary from envelope (always available, no disk read)
  const findings = slim ? (envelope.findingsSummary ?? []) : loadRunFindings(record);

  return NextResponse.json({
    id: record.id,
    goal: record.goal,
    repoName: record.repoName,
    repoUrl: record.repoUrl,
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt,
    result: {
      scorecard: envelope.scorecard,
      metrics: envelope.metrics,
      terminationReason: envelope.terminationReason,
      briefMarkdown: envelope.briefMarkdown,
      state: { findings },
    },
  }, { headers: cacheHeaders });
}
