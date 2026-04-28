'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';
import type { Finding } from '@/lib/runTransform';
import { ScorecardGrid, FindingsSection } from './CompleteView';
import { FindingsLoadingSkeleton } from './Skeleton';

interface SingleOverviewContentProps {
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  findings: Finding[];
  findingsLoading: boolean;
}

export function SingleOverviewContent({ scorecard, metrics, briefMarkdown, findings, findingsLoading }: SingleOverviewContentProps) {
  return (
    <div data-component="SingleOverviewContent" className="max-w-[860px] pt-5 pb-8">
      <ScorecardGrid scorecard={scorecard} metrics={metrics} />
      {findingsLoading && <FindingsLoadingSkeleton />}
      {findings.length > 0 && (
        <FindingsSection findings={findings} scorecard={scorecard} />
      )}
      <div className="md-content text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefMarkdown}</ReactMarkdown>
      </div>
    </div>
  );
}
