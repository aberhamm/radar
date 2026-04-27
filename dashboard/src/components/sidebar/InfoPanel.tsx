'use client';

import type { InfoPage } from '@/lib/useUrlState';

const INFO_LINKS: { id: InfoPage; label: string }[] = [
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'changelog', label: 'Changelog' },
];

interface InfoPanelProps {
  activePage?: InfoPage;
  onNavigate: (page: InfoPage) => void;
}

export function InfoPanel({ activePage, onNavigate }: InfoPanelProps) {
  return (
    <div data-component="InfoPanel" className="flex flex-col gap-3 h-full">
      <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-1">
        Info
      </div>
      <div className="flex flex-col gap-0.5">
        {INFO_LINKS.map((link) => (
          <button
            key={link.id}
            onClick={() => onNavigate(link.id)}
            className={`text-left rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
              activePage === link.id
                ? 'bg-[rgb(0_113_227/0.08)] text-tint'
                : 'text-secondary-label hover:text-label hover:bg-surface'
            }`}
          >
            {link.label}
          </button>
        ))}
      </div>
    </div>
  );
}
