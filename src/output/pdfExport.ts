/**
 * Client-ready PDF export — renders scorecard, findings, and executive summary
 * into a professional PDF suitable for handing to a VP or CTO.
 *
 * Uses pdfkit with built-in fonts (Helvetica/Courier) for universal compatibility.
 * Colors follow DESIGN.md semantic tokens.
 */

import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import type { Scorecard, CategoryScore, ScoreLevel, RunMetrics } from '../types/output.js';
import type { Finding, Severity } from '../types/findings.js';

// --- DESIGN.md color tokens ---
const COLORS = {
  danger: '#ff3b30',
  warning: '#ff9500',
  success: '#34c759',
  info: '#5ac8fa',
  labelPrimary: '#1d1d1f',
  labelSecondary: '#6e6e73',
  labelTertiary: '#86868b',
  surface: '#ffffff',
  canvas: '#f5f5f7',
  elevated: '#f2f2f7',
  separator: '#d1d1d6',
} as const;

function scoreColor(score: ScoreLevel): string {
  switch (score) {
    case 'red': return COLORS.danger;
    case 'yellow': return COLORS.warning;
    case 'green': return COLORS.success;
    default: return COLORS.labelTertiary;
  }
}

function severityColor(severity: Severity): string {
  switch (severity) {
    case 'critical': return COLORS.danger;
    case 'high': return '#e03e2d';
    case 'medium': return COLORS.warning;
    case 'low': return COLORS.info;
    case 'info': return COLORS.labelTertiary;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  stack: 'Stack & Framework',
  nextjs: 'Stack & Framework',
  'cms-integration': 'CMS Integration',
  'preview-editing': 'Preview & Editing',
  security: 'Security & Configuration',
  configuration: 'Security & Configuration',
  architecture: 'Architecture',
  routing: 'Architecture',
  'data-fetching': 'Architecture',
  dependencies: 'Dependencies',
  deployment: 'Deployment',
  performance: 'Performance',
  accessibility: 'Accessibility',
  forms: 'Forms & Inputs',
  aria: 'Dynamic Content',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export interface PdfExportOptions {
  scorecard: Scorecard;
  findings: Finding[];
  metrics: RunMetrics;
  sections?: Record<string, string>;
}

/**
 * Render a client-ready PDF and write it to disk.
 * Returns a promise that resolves to the written file path once the stream is flushed.
 */
export function renderPdf(outputPath: string, options: PdfExportOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { scorecard, findings, metrics } = options;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: `Radar — ${goalTitle(scorecard.goalType)}: ${scorecard.repoName}`,
        Author: 'Radar (repo-audit-delivery-agent)',
        Subject: `${scorecard.goalType} analysis`,
        CreationDate: new Date(scorecard.generatedAt),
      },
      bufferPages: true,
    });

    const stream = fs.createWriteStream(outputPath);
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
    doc.pipe(stream);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // --- Cover page ---
    renderCoverPage(doc, scorecard, metrics, pageWidth);

    // --- Executive Summary ---
    doc.addPage();
    renderExecSummary(doc, scorecard, metrics, pageWidth);

    // --- Scorecard table ---
    ensureSpace(doc, 200);
    renderScorecardTable(doc, scorecard, pageWidth);

    // --- Findings ---
    if (findings.length > 0) {
      doc.addPage();
      renderFindings(doc, scorecard, findings, pageWidth);
    }

    // --- Footer on every page ---
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      renderPageFooter(doc, i + 1, pageCount, scorecard);
    }

    doc.end();
  });
}

/**
 * Render PDF to a buffer (for testing / streaming).
 */
export function renderPdfToBuffer(options: PdfExportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { scorecard, findings, metrics } = options;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: `Radar — ${goalTitle(scorecard.goalType)}: ${scorecard.repoName}`,
        Author: 'Radar (repo-audit-delivery-agent)',
      },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    renderCoverPage(doc, scorecard, metrics, pageWidth);
    doc.addPage();
    renderExecSummary(doc, scorecard, metrics, pageWidth);
    ensureSpace(doc, 200);
    renderScorecardTable(doc, scorecard, pageWidth);

    if (findings.length > 0) {
      doc.addPage();
      renderFindings(doc, scorecard, findings, pageWidth);
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      renderPageFooter(doc, i + 1, pageCount, scorecard);
    }

    doc.end();
  });
}

// ───────────────────────────────────────────────────────────────
// Cover page
// ───────────────────────────────────────────────────────────────

function renderCoverPage(
  doc: PDFKit.PDFDocument,
  scorecard: Scorecard,
  metrics: RunMetrics,
  pageWidth: number,
): void {
  const mx = doc.page.margins.left;

  // Top accent bar
  doc.save();
  doc.rect(0, 0, doc.page.width, 6).fill(scoreColor(scorecard.overallScore));
  doc.restore();

  // Brand
  doc.moveDown(4);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.labelTertiary);
  doc.text('RADAR', mx, doc.y, { width: pageWidth });

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.labelTertiary);
  doc.text('Agentic Codebase Analysis', mx, doc.y, { width: pageWidth });

  // Repo name
  doc.moveDown(3);
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.labelPrimary);
  doc.text(scorecard.repoName, mx, doc.y, { width: pageWidth });

  // Goal
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(16).fillColor(COLORS.labelSecondary);
  doc.text(goalTitle(scorecard.goalType), mx, doc.y, { width: pageWidth });

  // Date
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(12).fillColor(COLORS.labelTertiary);
  const date = new Date(scorecard.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(date, mx, doc.y, { width: pageWidth });

  // Overall score badge
  doc.moveDown(3);
  const badgeY = doc.y;
  const badgeColor = scoreColor(scorecard.overallScore);

  // Score circle
  doc.save();
  doc.circle(mx + 24, badgeY + 24, 24).fill(badgeColor);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.surface);
  const scoreLabel = scorecard.overallScore.toUpperCase().charAt(0);
  doc.text(scoreLabel, mx + 14, badgeY + 14, { width: 20, align: 'center' });
  doc.restore();

  // Score text
  doc.font('Helvetica-Bold').fontSize(22).fillColor(badgeColor);
  doc.text(
    `Overall: ${scorecard.overallScore.toUpperCase()}`,
    mx + 64,
    badgeY + 8,
    { width: pageWidth - 64 },
  );
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.labelSecondary);
  doc.text(
    scoreVerdictLine(scorecard),
    mx + 64,
    doc.y + 2,
    { width: pageWidth - 64 },
  );

  // Stats row
  doc.moveDown(3);
  const statsY = doc.y;
  const statWidth = pageWidth / 4;

  renderStat(doc, mx, statsY, statWidth, String(totalFindings(scorecard)), 'Findings');
  renderStat(doc, mx + statWidth, statsY, statWidth, String(metrics.toolCalls), 'Tool Calls');
  renderStat(doc, mx + statWidth * 2, statsY, statWidth, formatDuration(metrics.durationMs), 'Duration');
  renderStat(doc, mx + statWidth * 3, statsY, statWidth, `$${metrics.totalEstimatedCostUsd.toFixed(2)}`, 'Est. Cost');
}

function renderStat(
  doc: PDFKit.PDFDocument,
  x: number, y: number, width: number,
  value: string, label: string,
): void {
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.labelPrimary);
  doc.text(value, x, y, { width, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelTertiary);
  doc.text(label.toUpperCase(), x, y + 26, { width, align: 'center' });
}

// ───────────────────────────────────────────────────────────────
// Executive Summary
// ───────────────────────────────────────────────────────────────

function renderExecSummary(
  doc: PDFKit.PDFDocument,
  scorecard: Scorecard,
  metrics: RunMetrics,
  pageWidth: number,
): void {
  const mx = doc.page.margins.left;

  sectionHeading(doc, 'Executive Summary', mx, pageWidth);

  // Severity breakdown
  const counts = severityCounts(scorecard);
  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;

  if (total > 0) {
    const barY = doc.y;
    const barHeight = 28;
    type SevEntry = { key: Severity; count: number; color: string };
    const allSeverities: SevEntry[] = [
      { key: 'critical', count: counts.critical, color: COLORS.danger },
      { key: 'high', count: counts.high, color: '#e03e2d' },
      { key: 'medium', count: counts.medium, color: COLORS.warning },
      { key: 'low', count: counts.low, color: COLORS.info },
      { key: 'info', count: counts.info, color: COLORS.labelTertiary },
    ];
    const severities = allSeverities.filter(s => s.count > 0);

    let barX = mx;
    for (const s of severities) {
      const segWidth = (s.count / total) * pageWidth;
      doc.save();
      doc.roundedRect(barX, barY, segWidth, barHeight, 3).fill(s.color);
      if (segWidth > 30) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.surface);
        doc.text(`${s.count}`, barX + 4, barY + 8, { width: segWidth - 8, align: 'center' });
      }
      doc.restore();
      barX += segWidth;
    }

    // Legend below bar
    doc.y = barY + barHeight + 8;
    const legendParts = severities.map(s => `${s.count} ${s.key}`);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelSecondary);
    doc.text(`${total} total findings: ${legendParts.join('  |  ')}`, mx, doc.y, { width: pageWidth });
    doc.moveDown(1);
  } else {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.labelSecondary);
    doc.text('No findings recorded.', mx, doc.y, { width: pageWidth });
    doc.moveDown(1);
  }

  // Top risks
  const risks = scorecard.topRisks.slice(0, 5);
  if (risks.length > 0) {
    doc.moveDown(0.5);
    subHeading(doc, 'Top Risks', mx, pageWidth);

    for (let i = 0; i < risks.length; i++) {
      const r = risks[i];
      ensureSpace(doc, 50);
      const riskY = doc.y;

      // Severity pip
      doc.save();
      doc.circle(mx + 6, riskY + 7, 5).fill(severityColor(r.severity as Severity));
      doc.restore();

      // Title + severity
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.labelPrimary);
      doc.text(`${r.rank}. ${r.title}`, mx + 18, riskY, { width: pageWidth - 18 });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelSecondary);
      doc.text(
        `${r.severity}`,
        mx + 18, doc.y, { width: pageWidth - 18 },
      );

      // Business context (truncated)
      const desc = truncate(r.businessContext, 200);
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelSecondary);
      doc.text(desc, mx + 18, doc.y + 2, { width: pageWidth - 18 });
      doc.moveDown(0.6);
    }
  }

  // Strengths
  const strengths = scorecard.categories.filter(c => c.score === 'green');
  if (strengths.length > 0) {
    doc.moveDown(0.5);
    subHeading(doc, 'Strengths', mx, pageWidth);
    for (const s of strengths.slice(0, 4)) {
      const label = s.findings.length === 0
        ? 'no issues found'
        : `${s.findings.length} minor finding${s.findings.length === 1 ? '' : 's'}`;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.success);
      doc.text(`  \u2713  ${categoryLabel(s.category)} \u2014 ${label}`, mx, doc.y, { width: pageWidth });
    }
  }
}

// ───────────────────────────────────────────────────────────────
// Scorecard table
// ───────────────────────────────────────────────────────────────

function renderScorecardTable(
  doc: PDFKit.PDFDocument,
  scorecard: Scorecard,
  pageWidth: number,
): void {
  const mx = doc.page.margins.left;

  doc.moveDown(1);
  sectionHeading(doc, 'Architecture Scorecard', mx, pageWidth);

  // Column widths
  const cols = {
    category: pageWidth * 0.28,
    score: pageWidth * 0.12,
    findings: pageWidth * 0.12,
    summary: pageWidth * 0.48,
  };

  // Header row
  const headerY = doc.y;
  doc.save();
  doc.rect(mx, headerY, pageWidth, 20).fill(COLORS.elevated);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.labelSecondary);
  doc.text('CATEGORY', mx + 6, headerY + 6, { width: cols.category });
  doc.text('SCORE', mx + cols.category + 6, headerY + 6, { width: cols.score });
  doc.text('FINDINGS', mx + cols.category + cols.score + 6, headerY + 6, { width: cols.findings });
  doc.text('SUMMARY', mx + cols.category + cols.score + cols.findings + 6, headerY + 6, { width: cols.summary });
  doc.restore();

  doc.y = headerY + 22;

  for (const cat of scorecard.categories) {
    ensureSpace(doc, 30);
    const rowY = doc.y;

    // Alternating row background
    const rowIndex = scorecard.categories.indexOf(cat);
    if (rowIndex % 2 === 0) {
      doc.save();
      doc.rect(mx, rowY, pageWidth, 22).fill('#fafafa');
      doc.restore();
    }

    // Category
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelPrimary);
    doc.text(categoryLabel(cat.category), mx + 6, rowY + 6, { width: cols.category - 12 });

    // Score pip + label
    const pipX = mx + cols.category + 6;
    doc.save();
    doc.circle(pipX + 4, rowY + 12, 4).fill(scoreColor(cat.score));
    doc.restore();
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelPrimary);
    doc.text(cat.score.toUpperCase(), pipX + 14, rowY + 6, { width: cols.score - 20 });

    // Findings count
    doc.text(String(cat.findings.length), mx + cols.category + cols.score + 6, rowY + 6, { width: cols.findings });

    // Summary (truncated)
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.labelSecondary);
    const summaryText = truncate(cat.summary, 80);
    doc.text(summaryText, mx + cols.category + cols.score + cols.findings + 6, rowY + 4, {
      width: cols.summary - 12,
      height: 20,
      ellipsis: true,
    });

    doc.y = rowY + 24;
  }

  // Bottom border
  doc.save();
  doc.moveTo(mx, doc.y).lineTo(mx + pageWidth, doc.y).strokeColor(COLORS.separator).lineWidth(0.5).stroke();
  doc.restore();
}

// ───────────────────────────────────────────────────────────────
// Findings detail
// ───────────────────────────────────────────────────────────────

function renderFindings(
  doc: PDFKit.PDFDocument,
  scorecard: Scorecard,
  findings: Finding[],
  pageWidth: number,
): void {
  const mx = doc.page.margins.left;

  sectionHeading(doc, 'Findings Detail', mx, pageWidth);

  // Sort by severity
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);

  let currentSeverity: Severity | null = null;

  for (const finding of sorted) {
    // Severity group header
    if (finding.severity !== currentSeverity) {
      currentSeverity = finding.severity;
      ensureSpace(doc, 60);
      doc.moveDown(0.8);
      subHeading(doc, `${currentSeverity.toUpperCase()} Findings`, mx, pageWidth);
    }

    ensureSpace(doc, 80);
    renderFindingCard(doc, finding, mx, pageWidth);
  }
}

function renderFindingCard(
  doc: PDFKit.PDFDocument,
  finding: Finding,
  mx: number,
  pageWidth: number,
): void {
  const cardY = doc.y;

  // Left severity accent
  doc.save();
  doc.rect(mx, cardY, 3, 4).fill(severityColor(finding.severity));
  doc.restore();

  // Title
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.labelPrimary);
  doc.text(finding.title, mx + 10, cardY, { width: pageWidth - 10 });

  // Metadata line
  const meta: string[] = [
    finding.severity,
    categoryLabel(finding.category),
  ];
  if (finding.confidence) meta.push(`confidence ${finding.confidence}/10`);
  if (finding.fingerprint) meta.push(`#${finding.fingerprint.slice(0, 8)}`);

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.labelTertiary);
  doc.text(meta.join('  \u00B7  '), mx + 10, doc.y + 1, { width: pageWidth - 10 });

  // Description
  const desc = truncate(finding.description, 400);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.labelSecondary);
  doc.text(desc, mx + 10, doc.y + 3, { width: pageWidth - 10 });

  // Evidence
  if (finding.evidence.length > 0) {
    doc.moveDown(0.3);
    for (const ev of finding.evidence.slice(0, 3)) {
      ensureSpace(doc, 30);
      const evLine = ev.lineNumber ? `:${ev.lineNumber}` : '';
      const badge = ev.verificationStatus === 'verified' ? ' [verified]'
        : ev.verificationStatus === 'corrected' ? ' [corrected]'
        : '';

      doc.font('Courier').fontSize(7.5).fillColor(COLORS.labelTertiary);
      doc.text(`${ev.filePath}${evLine}${badge}`, mx + 14, doc.y, { width: pageWidth - 14 });

      if (ev.description) {
        doc.font('Helvetica').fontSize(8).fillColor(COLORS.labelSecondary);
        doc.text(truncate(ev.description, 150), mx + 14, doc.y, { width: pageWidth - 14 });
      }
    }
    if (finding.evidence.length > 3) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.labelTertiary);
      doc.text(`+ ${finding.evidence.length - 3} more evidence items`, mx + 14, doc.y, { width: pageWidth - 14 });
    }
  }

  // Extend the accent bar to full card height
  const cardHeight = doc.y - cardY;
  doc.save();
  doc.rect(mx, cardY, 3, cardHeight).fill(severityColor(finding.severity));
  doc.restore();

  // Separator
  doc.moveDown(0.6);
  doc.save();
  doc.moveTo(mx + 10, doc.y).lineTo(mx + pageWidth, doc.y)
    .strokeColor(COLORS.separator).lineWidth(0.25).stroke();
  doc.restore();
  doc.moveDown(0.4);
}

// ───────────────────────────────────────────────────────────────
// Page footer
// ───────────────────────────────────────────────────────────────

function renderPageFooter(
  doc: PDFKit.PDFDocument,
  pageNum: number,
  totalPages: number,
  scorecard: Scorecard,
): void {
  const mx = doc.page.margins.left;
  const pageWidth = doc.page.width - mx - doc.page.margins.right;
  const footerY = doc.page.height - doc.page.margins.bottom + 16;

  // Separator line
  doc.save();
  doc.moveTo(mx, footerY - 8).lineTo(mx + pageWidth, footerY - 8)
    .strokeColor(COLORS.separator).lineWidth(0.25).stroke();
  doc.restore();

  // Left: brand + repo
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.labelTertiary);
  doc.text(`Radar \u2014 ${scorecard.repoName}`, mx, footerY, { width: pageWidth / 2 });

  // Right: page number
  doc.text(
    `Page ${pageNum} of ${totalPages}`,
    mx + pageWidth / 2,
    footerY,
    { width: pageWidth / 2, align: 'right' },
  );
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function sectionHeading(doc: PDFKit.PDFDocument, text: string, mx: number, pageWidth: number): void {
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.labelPrimary);
  doc.text(text, mx, doc.y, { width: pageWidth });
  doc.moveDown(0.3);
  doc.save();
  doc.moveTo(mx, doc.y).lineTo(mx + pageWidth, doc.y)
    .strokeColor(COLORS.separator).lineWidth(0.5).stroke();
  doc.restore();
  doc.moveDown(0.8);
}

function subHeading(doc: PDFKit.PDFDocument, text: string, mx: number, pageWidth: number): void {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.labelPrimary);
  doc.text(text, mx, doc.y, { width: pageWidth });
  doc.moveDown(0.4);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < needed) {
    doc.addPage();
  }
}

function goalTitle(goalType: string): string {
  const titles: Record<string, string> = {
    onboarding: 'Onboarding Brief',
    audit: 'Architecture Audit',
    'audit-generic': 'Architecture Audit',
    migration: 'Migration Scout Report',
    'component-map': 'Component Map',
    'ci-check': 'CI Health Check',
    'security-review': 'Security Review',
    nextjs: 'Next.js Health Check',
    accessibility: 'Accessibility Audit',
  };
  return titles[goalType] ?? 'Analysis Report';
}

function scoreVerdictLine(scorecard: Scorecard): string {
  const redCount = scorecard.categories.filter(c => c.score === 'red').length;
  const yellowCount = scorecard.categories.filter(c => c.score === 'yellow').length;
  const totalCats = scorecard.categories.length;

  switch (scorecard.overallScore) {
    case 'red':
      return `${redCount} of ${totalCats} categories have critical issues requiring immediate attention.`;
    case 'yellow':
      return `${yellowCount} of ${totalCats} categories have issues worth addressing. No critical blockers.`;
    case 'green':
      return `All ${totalCats} categories are healthy. No significant issues found.`;
    default:
      return `${totalCats} categories analyzed.`;
  }
}

function totalFindings(scorecard: Scorecard): number {
  return scorecard.categories.reduce((sum, c) => sum + c.findings.length, 0);
}

function severityCounts(scorecard: Scorecard): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const cat of scorecard.categories) {
    for (const f of cat.findings) {
      counts[f.severity]++;
    }
  }
  return counts;
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
