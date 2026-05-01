import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

interface PdfExportOptions {
  scorecard: Record<string, unknown>;
  findings: unknown[];
  metrics: Record<string, unknown>;
}

async function loadPdfExport() {
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');

  const distPath = path.resolve(process.cwd(), '..', 'dist', 'output', 'pdfExport.js');
  if (fs.existsSync(distPath)) {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(distPath).href);
    return mod.renderPdfToBuffer as (opts: PdfExportOptions) => Promise<Buffer>;
  }

  const { register } = await import(/* webpackIgnore: true */ 'node:module');
  try { register('tsx/esm', pathToFileURL('./')); } catch { /* already registered */ }
  const srcPath = path.resolve(process.cwd(), '..', 'src', 'output', 'pdfExport.ts');
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(srcPath).href);
  return mod.renderPdfToBuffer as (opts: PdfExportOptions) => Promise<Buffer>;
}

/**
 * POST /api/export-pdf
 *
 * Accepts scorecard + findings + metrics as JSON, returns a PDF binary.
 * Used by the dashboard's "Export PDF" button.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scorecard, findings, metrics } = body as PdfExportOptions;

    if (!scorecard || !metrics) {
      return NextResponse.json(
        { error: 'scorecard and metrics are required' },
        { status: 400 },
      );
    }

    const safeMetrics = {
      ...metrics,
      durationMs: (metrics as any).durationMs ?? 0,
      toolCalls: (metrics as any).toolCalls ?? 0,
      totalEstimatedCostUsd: (metrics as any).totalEstimatedCostUsd ?? 0,
      models: (metrics as any).models ?? {},
      startedAt: (metrics as any).startedAt ?? '',
      completedAt: (metrics as any).completedAt ?? '',
    };

    const renderPdfToBuffer = await loadPdfExport();
    const pdfBuffer = await renderPdfToBuffer({
      scorecard,
      findings: findings ?? [],
      metrics: safeMetrics,
    });

    const slug = String(scorecard.repoName ?? 'report').replace(/[^a-zA-Z0-9-]/g, '-');

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slug}-report.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (err) {
    console.error('[export-pdf] Failed:', err);
    return NextResponse.json(
      { error: 'PDF generation failed' },
      { status: 500 },
    );
  }
}
