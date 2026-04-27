'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChangelogView() {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/changelog')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setContent(data.content);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}
        {content === null && !error && (
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-8 w-48 bg-elevated rounded-md" />
            <div className="h-4 w-full bg-elevated rounded-md" />
            <div className="h-4 w-3/4 bg-elevated rounded-md" />
            <div className="h-4 w-5/6 bg-elevated rounded-md" />
          </div>
        )}
        {content !== null && (
          <div className="md-content text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
