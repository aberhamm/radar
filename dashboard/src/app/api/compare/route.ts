import { NextRequest, NextResponse } from 'next/server';
import { getSession, loadRunEnvelope, loadRunFindings } from '@/lib/agentSession';
import { diffFindings, type RawFinding } from '@/lib/compareUtils';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';

// ── Finding transform (mirrors runTransform.ts:207-215) ────────

interface DashboardFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  evidenceFiles: string[];
  note: string;
  tags: string[];
}

function transformFinding(f: RawFinding): DashboardFinding {
  return {
    id: f.id,
    severity: f.severity as DashboardFinding['severity'],
    category: f.category,
    title: f.title,
    evidenceFiles: (f.evidence ?? []).map(e => e.filePath),
    note: f.investigationNote ?? f.description ?? '',
    tags: f.tags ?? [],
  };
}

// ── Route handler ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const idA = searchParams.get('a');
  const idB = searchParams.get('b');

  if (!idA || !idB) {
    return NextResponse.json({ error: 'Both ?a= and ?b= run IDs are required' }, { status: 400 });
  }

  if (idA === idB) {
    return NextResponse.json({ error: 'Cannot compare a run with itself' }, { status: 400 });
  }

  const session = getSession();
  const recordA = session.history.find(r => r.id === idA);
  const recordB = session.history.find(r => r.id === idB);

  if (!recordA || !recordB) {
    const missing = !recordA ? idA : idB;
    return NextResponse.json({ error: `Run not found: ${missing}` }, { status: 404 });
  }

  // Resolve result data: use in-memory if available, otherwise load from disk
  const resultA = recordA.result ?? null;
  const resultB = recordB.result ?? null;
  const envelopeA = resultA ? null : loadRunEnvelope(recordA);
  const envelopeB = resultB ? null : loadRunEnvelope(recordB);

  const scorecardA = resultA?.scorecard ?? envelopeA?.scorecard;
  const scorecardB = resultB?.scorecard ?? envelopeB?.scorecard;
  const metricsA = resultA?.metrics ?? envelopeA?.metrics;
  const metricsB = resultB?.metrics ?? envelopeB?.metrics;

  if (!scorecardA || !scorecardB) {
    const incomplete = !scorecardA ? recordA.repoName : recordB.repoName;
    return NextResponse.json({ error: `Run has no results: ${incomplete}` }, { status: 400 });
  }

  // Extract raw findings: in-memory or from disk (Tier 3)
  const rawA = (resultA
    ? (resultA.state?.findings ?? [])
    : loadRunFindings(recordA)) as RawFinding[];
  const rawB = (resultB
    ? (resultB.state?.findings ?? [])
    : loadRunFindings(recordB)) as RawFinding[];

  // Diff on raw findings (fingerprints work on original data)
  const diff = diffFindings(rawA, rawB);

  // Build response with transformed findings
  return NextResponse.json({
    runA: {
      id: recordA.id,
      repoName: recordA.repoName,
      goal: recordA.goal,
      startedAt: recordA.startedAt,
      scorecard: scorecardA,
      metrics: metricsA,
      findings: rawA.map(transformFinding),
    },
    runB: {
      id: recordB.id,
      repoName: recordB.repoName,
      goal: recordB.goal,
      startedAt: recordB.startedAt,
      scorecard: scorecardB,
      metrics: metricsB,
      findings: rawB.map(transformFinding),
    },
    diff: {
      newFindings: diff.newFindings.map(transformFinding),
      resolvedFindings: diff.resolvedFindings.map(transformFinding),
      persistentFindings: diff.persistentFindings.map(transformFinding),
      summary: diff.summary,
    },
  });
}
