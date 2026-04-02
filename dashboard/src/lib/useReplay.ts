import { useState, useRef, useCallback, useEffect } from 'react';
import type { StepEvent } from './agentSession';

export type ReplaySpeed = 1 | 2 | 5 | 10;

interface ReplayState {
  /** Events emitted so far (grows as replay progresses) */
  events: StepEvent[];
  /** Whether replay is currently playing */
  playing: boolean;
  /** Current position in the source events array */
  position: number;
  /** Total events in the source */
  total: number;
  /** Current playback speed multiplier */
  speed: ReplaySpeed;
  /** Whether replay has finished */
  done: boolean;
}

interface ReplayControls {
  state: ReplayState;
  /** Start or resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Jump to a specific position */
  seek: (position: number) => void;
  /** Change playback speed */
  setSpeed: (speed: ReplaySpeed) => void;
  /** Reset to beginning */
  reset: () => void;
  /** Skip to end (show all events) */
  skipToEnd: () => void;
}

const DEFAULT_DELAY_MS = 300; // for events without timestamps

function getDelay(current: StepEvent, next: StepEvent | undefined, speed: ReplaySpeed): number {
  if (!next) return 0;

  // If both have timestamps, use real timing
  if (current.timestamp && next.timestamp) {
    const diff = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
    // Clamp to reasonable range: 50ms - 3000ms (before speed adjustment)
    const clamped = Math.max(50, Math.min(3000, diff));
    return clamped / speed;
  }

  // Fallback: fixed delay, shorter for same-batch events
  if (current.batchId && next.batchId && current.batchId === next.batchId) {
    return 80 / speed; // parallel calls appear fast
  }
  return DEFAULT_DELAY_MS / speed;
}

export function useReplay(sourceEvents: StepEvent[]): ReplayControls {
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);
  const [done, setDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef(0);
  const speedRef = useRef<ReplaySpeed>(1);

  // Keep refs in sync
  posRef.current = position;
  speedRef.current = speed;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const emitNext = useCallback(() => {
    const pos = posRef.current;
    if (pos >= sourceEvents.length) {
      setDone(true);
      setPlaying(false);
      return;
    }

    const event = sourceEvents[pos];
    const nextPos = pos + 1;

    setEvents(prev => [...prev, event]);
    setPosition(nextPos);
    posRef.current = nextPos;

    if (nextPos < sourceEvents.length) {
      const delay = getDelay(event, sourceEvents[nextPos], speedRef.current);
      timerRef.current = setTimeout(emitNext, delay);
    } else {
      setDone(true);
      setPlaying(false);
    }
  }, [sourceEvents]);

  const play = useCallback(() => {
    if (posRef.current >= sourceEvents.length) return;
    setPlaying(true);
    setDone(false);
    emitNext();
  }, [sourceEvents, emitNext]);

  const pause = useCallback(() => {
    clearTimer();
    setPlaying(false);
  }, [clearTimer]);

  const seek = useCallback((pos: number) => {
    clearTimer();
    const clamped = Math.max(0, Math.min(pos, sourceEvents.length));
    setEvents(sourceEvents.slice(0, clamped));
    setPosition(clamped);
    posRef.current = clamped;
    setDone(clamped >= sourceEvents.length);
    setPlaying(false);
  }, [sourceEvents, clearTimer]);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
    speedRef.current = s;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setEvents([]);
    setPosition(0);
    posRef.current = 0;
    setDone(false);
    setPlaying(false);
  }, [clearTimer]);

  const skipToEnd = useCallback(() => {
    clearTimer();
    setEvents([...sourceEvents]);
    setPosition(sourceEvents.length);
    posRef.current = sourceEvents.length;
    setDone(true);
    setPlaying(false);
  }, [sourceEvents, clearTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return {
    state: { events, playing, position, total: sourceEvents.length, speed, done },
    play,
    pause,
    seek,
    setSpeed,
    reset,
    skipToEnd,
  };
}
