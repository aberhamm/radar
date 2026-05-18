'use client';

import { useRef, useEffect, useState } from 'react';

interface SnapshotPoint {
  step: number;
  findingsCount: number;
  filesReadCount: number;
  toolCallsUsed: number;
}

function buildPolyline(points: SnapshotPoint[], field: 'findingsCount' | 'filesReadCount'): string {
  if (points.length < 2) return '';
  const maxX = points[points.length - 1].toolCallsUsed || 1;
  const maxY = Math.max(...points.map(p => p[field])) || 1;
  return points
    .map(p => `${(p.toolCallsUsed / maxX) * 100},${100 - (p[field] / maxY) * 100}`)
    .join(' ');
}

function buildPolygon(points: SnapshotPoint[], field: 'findingsCount' | 'filesReadCount'): string {
  const line = buildPolyline(points, field);
  if (!line) return '';
  const maxX = points[points.length - 1].toolCallsUsed || 1;
  const lastX = (points[points.length - 1].toolCallsUsed / maxX) * 100;
  return `0,100 ${line} ${lastX},100`;
}

export function InvestigationCurve({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const pathRef = useRef<SVGPolylineElement>(null);
  const [pathLength, setPathLength] = useState(0);

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [snapshots]);

  if (snapshots.length < 2) {
    return (
      <div data-component="InvestigationCurve">
        <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-2">
          Investigation Curve
        </div>
        <div className="flex items-center justify-center h-[160px] bg-surface rounded-lg border border-separator">
          <p className="text-xs text-tertiary-label">Accumulation data not available (pre-telemetry run)</p>
        </div>
      </div>
    );
  }

  const findingsLine = buildPolyline(snapshots, 'findingsCount');
  const filesLine = buildPolyline(snapshots, 'filesReadCount');
  const findingsFill = buildPolygon(snapshots, 'findingsCount');
  const maxFindings = Math.max(...snapshots.map(p => p.findingsCount));
  const maxFiles = Math.max(...snapshots.map(p => p.filesReadCount));
  const maxCalls = snapshots[snapshots.length - 1].toolCallsUsed;

  return (
    <div data-component="InvestigationCurve">
      <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-2">
        Investigation Curve
      </div>
      <div className="bg-surface rounded-lg border border-separator shadow-sm p-3">
        <div className="relative">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-[160px]"
          >
            <defs>
              <linearGradient id="findings-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-tint)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--color-tint)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="25" x2="100" y2="25" stroke="var(--color-separator)" strokeWidth="0.3" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="var(--color-separator)" strokeWidth="0.3" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="var(--color-separator)" strokeWidth="0.3" />

            {findingsFill && (
              <polygon points={findingsFill} fill="url(#findings-fill)" />
            )}
            {filesLine && (
              <polyline
                points={filesLine}
                fill="none"
                stroke="var(--color-success)"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.7"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {findingsLine && (
              <polyline
                ref={pathRef}
                points={findingsLine}
                fill="none"
                stroke="var(--color-tint)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={pathLength ? {
                  strokeDasharray: pathLength,
                  strokeDashoffset: pathLength,
                  animation: 'drawLine 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards',
                } : undefined}
              />
            )}
          </svg>
          <div className="absolute top-0 right-0 text-[9px] font-mono text-tertiary-label">
            {maxFindings} findings / {maxFiles} files
          </div>
          <div className="absolute bottom-0 right-0 text-[9px] font-mono text-tertiary-label">
            {maxCalls} calls
          </div>
        </div>
        <div className="flex gap-4 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-tint" />
            <span className="text-[10px] text-secondary-label">Findings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-[10px] text-secondary-label">Files Read</span>
          </div>
        </div>
      </div>
    </div>
  );
}
