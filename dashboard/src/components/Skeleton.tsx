'use client';

import React from 'react';

/* ── Primitive ────────────────────────────────────────────────────── */

interface BarProps {
  width?: string;
  height?: string;
  className?: string;
}

/** Single shimmer bar. Width/height accept any CSS value. */
function Bar({ width = '100%', height = '12px', className = '' }: BarProps) {
  return (
    <div
      className={`rounded animate-skeleton ${className}`}
      style={{ width, height }}
    />
  );
}

/* ── Composites ───────────────────────────────────────────────────── */

/** Mimics a finding card skeleton (severity pip + title + two detail lines). */
export function FindingCardSkeleton() {
  return (
    <div
      data-component="FindingCardSkeleton"
      className="rounded-xl border border-separator bg-surface p-4 space-y-3"
      style={{ animation: 'fadeIn 0.3s ease both' }}
    >
      <div className="flex items-center gap-2">
        <Bar width="6px" height="6px" className="rounded-full shrink-0" />
        <Bar width="55%" height="13px" />
      </div>
      <Bar width="80%" height="11px" />
      <Bar width="40%" height="11px" />
    </div>
  );
}

/** Mimics a rule block skeleton (label + code block). */
export function RuleBlockSkeleton() {
  return (
    <div
      data-component="RuleBlockSkeleton"
      className="mb-8"
      style={{ animation: 'fadeIn 0.3s ease both' }}
    >
      <Bar width="120px" height="10px" className="mb-3" />
      <div className="rounded-lg border border-separator bg-surface p-4 space-y-2.5">
        <Bar width="90%" height="10px" />
        <Bar width="75%" height="10px" />
        <Bar width="60%" height="10px" />
        <Bar width="85%" height="10px" />
      </div>
    </div>
  );
}

/** Mimics event stream rows (timestamp + label). */
export function EventRowSkeleton() {
  return (
    <div data-component="EventRowSkeleton" className="flex items-center gap-3 py-1.5 px-4">
      <Bar width="52px" height="10px" className="shrink-0" />
      <Bar width="10px" height="10px" className="rounded-full shrink-0" />
      <Bar height="11px" className="flex-1" />
    </div>
  );
}

/** Mimics a history run card (icon + repo name/goal + date + chevron). */
export function HistoryRunCardSkeleton() {
  return (
    <div data-component="HistoryRunCardSkeleton" className="flex items-center gap-2.5 w-full px-3 py-2 min-h-[44px] rounded-lg bg-elevated border border-transparent">
      <Bar width="16px" height="16px" className="rounded shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Bar width="70%" height="13px" />
        <Bar width="40%" height="10px" />
      </div>
      <Bar width="8px" height="12px" className="rounded shrink-0" />
    </div>
  );
}

/* ── Staggered bar spinner ────────────────────────────────────────── */

/** Replaces the generic border spinner. Five bars with staggered pulse. */
export function StaggeredSpinner({ color = 'var(--color-tint)', size = 20 }: { color?: string; size?: number }) {
  const barCount = 4;
  const barWidth = Math.max(2, size / 6);
  const gap = Math.max(1.5, size / 10);
  return (
    <div data-component="StaggeredSpinner" className="flex items-center justify-center" style={{ height: size, gap }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: size * 0.7,
            borderRadius: barWidth,
            background: color,
            animation: `stagger-pulse 1s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Full-view loading skeletons ──────────────────────────────────── */

/**
 * Mimics the RunView layout: header + tab bar + report body.
 */
export function RunLoadingSkeleton() {
  return (
    <div data-component="RunLoadingSkeleton" className="flex-1 flex flex-col overflow-hidden">
      {/* ── Run header ── matches RunHeader */}
      <div className="px-6 py-3 border-b border-separator bg-surface shrink-0">
        <div className="flex items-center gap-4 max-w-[860px]">
          <Bar width="180px" height="15px" />
          <div className="flex items-center gap-3">
            <Bar width="60px" height="12px" />
            <Bar width="70px" height="12px" />
            <Bar width="65px" height="12px" />
            <Bar width="48px" height="12px" />
            <Bar width="36px" height="12px" />
          </div>
        </div>
      </div>

      {/* ── Segmented tab bar ── matches tab control (Report / Events / Rules / Cost) */}
      <div className="bg-surface border-b border-separator px-6 py-2.5 flex items-center">
        <div className="bg-elevated rounded-lg p-0.5 flex gap-0.5">
          {/* First tab appears "selected" — surface bg + shadow */}
          <div className="rounded-md bg-surface shadow-sm" style={{ width: '82px', height: '32px' }} />
          {['72px', '64px', '56px'].map((w, i) => (
            <div key={i} className="rounded-md animate-skeleton" style={{ minWidth: w, height: '32px', padding: '6px 20px' }} />
          ))}
        </div>
      </div>

      {/* ── Report body ── matches Verdict + TopRisks + Category rows */}
      <div className="flex-1 overflow-y-auto px-6">
        <div className="max-w-[860px] pt-5 pb-8">
          {/* Verdict — large grade + repo name + metadata */}
          <div className="flex items-start gap-5 mb-8">
            <Bar width="72px" height="72px" className="rounded-2xl shrink-0" />
            <div className="pt-1 flex-1 space-y-2">
              <Bar width="180px" height="15px" />
              <Bar width="260px" height="12px" />
              <Bar width="200px" height="10px" />
            </div>
          </div>

          {/* Top risks — label + 3 risk rows */}
          <div className="mb-8">
            <Bar width="64px" height="10px" className="mb-3" />
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-separator mb-1.5">
                <Bar width="52px" height="10px" className="shrink-0" />
                <Bar width="65%" height="12px" />
              </div>
            ))}
          </div>

          {/* Unified category rows */}
          <div className="mb-8">
            <Bar width="120px" height="10px" className="mb-3" />
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-separator overflow-hidden">
                  <div className="px-3 py-2.5 flex items-center gap-3">
                    <Bar width="28px" height="28px" className="rounded-lg shrink-0" />
                    <Bar height="12px" className="flex-1" />
                    <Bar width="16px" height="10px" />
                    <Bar width="8px" height="8px" className="shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Preset groups ────────────────────────────────────────────────── */

export function FindingsLoadingSkeleton() {
  return (
    <div data-component="FindingsLoadingSkeleton" className="space-y-3 mb-4 animate-slide-up">
      {[0, 1, 2].map(i => (
        <div key={i} style={{ animationDelay: `${i * 0.08}s` }}>
          <FindingCardSkeleton />
        </div>
      ))}
    </div>
  );
}

export function RulesLoadingSkeleton() {
  return (
    <div data-component="RulesLoadingSkeleton" className="py-6 animate-slide-up">
      {[0, 1, 2].map(i => (
        <div key={i} style={{ animationDelay: `${i * 0.08}s` }}>
          <RuleBlockSkeleton />
        </div>
      ))}
    </div>
  );
}

export function EventsLoadingSkeleton() {
  return (
    <div data-component="EventsLoadingSkeleton" className="py-2 space-y-0.5 animate-slide-up">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ animation: `fadeIn 0.3s ease ${i * 0.04}s both` }}>
          <EventRowSkeleton />
        </div>
      ))}
    </div>
  );
}

export function CachedReposLoadingSkeleton() {
  return (
    <div data-component="CachedReposLoadingSkeleton" className="px-6 pb-6 animate-slide-up" style={{ animationDelay: '100ms' }}>
      <Bar width="115px" height="12px" className="mb-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ animation: `fadeIn 0.3s ease ${i * 0.06}s both` }}>
            <HistoryRunCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

export function HistoryLoadingSkeleton() {
  return (
    <div data-component="HistoryLoadingSkeleton" className="px-6 pb-8 animate-slide-up" style={{ animationDelay: '150ms' }}>
      <Bar width="90px" height="12px" className="mb-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ animation: `fadeIn 0.3s ease ${i * 0.06}s both` }}>
            <HistoryRunCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
