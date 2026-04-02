'use client';

import { useState, useEffect, useRef } from 'react';

const WORDS = ['analyzing', 'scanning', 'inspecting', 'mapping', 'probing', 'tracing', 'auditing'];

const TYPE_SPEED = 70;
const DELETE_SPEED = 40;
const PAUSE_AFTER_TYPE = 1800;
const PAUSE_AFTER_DELETE = 400;

interface TerminalBrandProps {
  isRunning: boolean;
}

export function TerminalBrand({ isRunning }: TerminalBrandProps) {
  const [suffix, setSuffix] = useState('');
  const wordIndex = useRef(0);
  const charIndex = useRef(0);
  const phase = useRef<'idle' | 'typing' | 'paused' | 'deleting' | 'gap'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isRunning) {
      // Reset when not running
      phase.current = 'idle';
      charIndex.current = 0;
      setSuffix('');
      if (timer.current) clearTimeout(timer.current);
      return;
    }

    // Start typing cycle
    phase.current = 'typing';
    charIndex.current = 0;
    wordIndex.current = Math.floor(Math.random() * WORDS.length);

    function tick() {
      const word = WORDS[wordIndex.current];

      if (phase.current === 'typing') {
        charIndex.current++;
        setSuffix(' ' + word.slice(0, charIndex.current));
        if (charIndex.current >= word.length) {
          phase.current = 'paused';
          timer.current = setTimeout(tick, PAUSE_AFTER_TYPE);
        } else {
          timer.current = setTimeout(tick, TYPE_SPEED);
        }
      } else if (phase.current === 'paused') {
        phase.current = 'deleting';
        timer.current = setTimeout(tick, DELETE_SPEED);
      } else if (phase.current === 'deleting') {
        charIndex.current--;
        if (charIndex.current <= 0) {
          setSuffix('');
          phase.current = 'gap';
          timer.current = setTimeout(tick, PAUSE_AFTER_DELETE);
        } else {
          setSuffix(' ' + word.slice(0, charIndex.current));
          timer.current = setTimeout(tick, DELETE_SPEED);
        }
      } else if (phase.current === 'gap') {
        wordIndex.current = (wordIndex.current + 1) % WORDS.length;
        charIndex.current = 0;
        phase.current = 'typing';
        timer.current = setTimeout(tick, TYPE_SPEED);
      }
    }

    // Small delay before first word starts typing
    timer.current = setTimeout(tick, 600);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [isRunning]);

  return (
    <div className="flex items-center whitespace-nowrap font-brand select-none">
      <span className="text-base text-tertiary-label font-semibold mr-1">{'>'}</span>
      <span className="text-base font-bold text-tint tracking-tight">
        radar
      </span>
      {suffix && (
        <span className="text-base font-medium text-secondary-label tracking-tight">
          {suffix}
        </span>
      )}
      <span
        className="inline-block w-[2px] h-[18px] bg-tint rounded-[1px] ml-px align-middle"
        style={{ animation: 'cursor-blink 1s step-end infinite' }}
      />
    </div>
  );
}
