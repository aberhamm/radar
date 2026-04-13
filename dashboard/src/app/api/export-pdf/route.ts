import { NextRequest, NextResponse } from 'next/server';
import { renderPdfToBuffer } from '@agent/output/pdfExport';
import type { PdfExportOptions } from '@agent/output/pdfExport';

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

    const pdfBuffer = await renderPdfToBuffer({
      scorecard,
      findings: findings ?? [],
      metrics,
    });

    const slug = scorecard.repoName.replace(/[^a-zA-Z0-9-]/g, '-');

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
