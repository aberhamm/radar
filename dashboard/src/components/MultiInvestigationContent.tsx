'use client';

import { useState, useCallback, useMemo } from 'react';
import type { TransformedRunData } from '@/lib/runTransform';
import { AnalysisView } from './AnalysisView';

interface MultiInvestigationContentProps {
  combinedRunData?: TransformedRunData;
}

function sliceRunDataByPass(
  runData: TransformedRunData,
  passName: string,
): TransformedRunData {
  const turns = runData.analysisTurns.filter(t => t.passName === passName);

  const coveredCategories = new Set<string>();
  for (const t of turns) {
    for (const c of t.categoriesCovered) coveredCategories.add(c);
  }

  const findings = coveredCategories.size > 0
    ? runData.findings.filter(f => coveredCategories.has(f.category))
    : runData.findings;

  return { analysisTurns: turns, findings, findingBatches: [findings.length] };
}

export function MultiInvestigationContent({ combinedRunData }: MultiInvestigationContentProps) {
  const [selectedPass, setSelectedPass] = useState<string | null>(null);

  const passNames = useMemo(() => {
    if (!combinedRunData) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const t of combinedRunData.analysisTurns) {
      if (t.passName && !seen.has(t.passName)) {
        seen.add(t.passName);
        names.push(t.passName);
      }
    }
    return names;
  }, [combinedRunData]);

  const filteredRunData = useMemo(() => {
    if (!combinedRunData || !selectedPass) return combinedRunData;
    return sliceRunDataByPass(combinedRunData, selectedPass);
  }, [combinedRunData, selectedPass]);

  const handlePassSelect = useCallback((pass: string | null) => {
    setSelectedPass(pass);
  }, []);

  if (!combinedRunData) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-tertiary-label">No investigation events available.</p>
      </div>
    );
  }

  const showPills = passNames.length > 1;

  return (
    <div data-component="MultiInvestigationContent" className="flex-1 flex flex-col overflow-hidden">
      {showPills && (
        <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-separator bg-surface shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => handlePassSelect(null)}
            className={`px-3 py-1 text-[12px] font-medium rounded-md transition-all cursor-pointer shrink-0 ${
              !selectedPass
                ? 'bg-tint text-white'
                : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover'
            }`}
          >
            All passes
          </button>
          {passNames.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => handlePassSelect(name)}
              className={`px-3 py-1 text-[12px] font-medium rounded-md transition-all cursor-pointer shrink-0 ${
                selectedPass === name
                  ? 'bg-tint text-white'
                  : 'bg-elevated text-secondary-label hover:text-label hover:bg-tint-hover'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <AnalysisView key={selectedPass ?? '__all'} runData={filteredRunData} />
    </div>
  );
}
