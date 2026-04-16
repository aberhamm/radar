import { useState, useCallback, useRef, useEffect } from 'react';
import type { Finding, AnalysisTurn, StreamTurn } from '@/lib/runTransform';

// ─── Types ──────────────────────────────────────────────────────

export type AnimationPhase = 'idle' | 'analyzing' | 'switching' | 'recording' | 'assembling' | 'done';

export interface AnimationState {
  phase: AnimationPhase;
  turns: StreamTurn[];
  typingText: string;
  activeTurnIndex: number | null;
  coveredTopics: Set<string>;
  examinedFiles: string[];
  findings: Finding[];
  scoreVisible: boolean;
  progressPercent: number;
  pendingActions: string[];
}

export interface AnimationActions {
  run: () => void;
  reset: () => void;
}

// ─── Hook ───────────────────────────────────────────────────────

/**
 * Drives the replay animation for completed runs.
 *
 * `allTurns` includes investigation turns, switch markers, and pass
 * boundaries — the hook treats switches/boundaries as instant visual
 * markers and types out regular investigation turns character-by-character.
 */
export function useAnimationSequence(
  allTurns: AnalysisTurn[],
  allFindings: Finding[],
  findingBatches: number[],
): AnimationState & AnimationActions {
  const [phase, setPhase] = useState<AnimationPhase>('idle');
  const [turns, setTurns] = useState<StreamTurn[]>([]);
  const [typingText, setTypingText] = useState('');
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const [coveredTopics, setCoveredTopics] = useState<Set<string>>(new Set());
  const [examinedFiles, setExaminedFiles] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scoreVisible, setScoreVisible] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up all timers on unmount
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const t = useCallback((fn: () => void, delay: number) => {
    timersRef.current.push(setTimeout(fn, delay));
  }, []);

  const reset = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setPhase('idle');
    setTurns([]);
    setTypingText('');
    setActiveTurnIndex(null);
    setCoveredTopics(new Set());
    setExaminedFiles([]);
    setFindings([]);
    setScoreVisible(false);
    setProgressPercent(0);
  }, []);

  const run = useCallback(() => {
    reset();

    setTimeout(() => {
      setPhase('analyzing');
      let d = 0;
      const typeSpeed = 10;

      // ── Investigation turns (including switches + pass boundaries) ──
      // Progress: 3% → 60% across all investigation turns
      const totalTurns = allTurns.length;
      let streamTurnCounter = 0;

      allTurns.forEach((turn, turnIdx) => {
        const turnPct = 3 + ((turnIdx + 1) / totalTurns) * 57;

        // ── Switch marker: instant push, no typing ──
        if (turn.isSwitch) {
          const thisTurnIndex = streamTurnCounter++;
          t(() => {
            setPhase('switching');
            setProgressPercent(Math.round(turnPct));
            setActiveTurnIndex(null);
            setTurns(prev => [...prev, {
              reasoning: '',
              activities: [],
              phase: 'analyze',
              isSwitch: true,
            }]);
          }, d);
          d += 800;
          // Restore analyzing phase for subsequent turns
          t(() => setPhase('analyzing'), d);
          void thisTurnIndex; // used for counter only
          return;
        }

        // ── Pass boundary marker: instant push ──
        if (turn.isPassBoundary) {
          const thisTurnIndex = streamTurnCounter++;
          t(() => {
            setProgressPercent(Math.round(turnPct));
            setTurns(prev => [...prev, {
              reasoning: turn.passName ?? 'Next pass',
              activities: [],
              phase: 'analyze',
              isPassBoundary: true,
              passName: turn.passName,
            }]);
          }, d);
          d += 500;
          void thisTurnIndex;
          return;
        }

        // ── Regular investigation turn: type reasoning + push activities ──
        const text = turn.reasoning;
        const typeTime = text.length * typeSpeed;
        const thisTurnIndex = streamTurnCounter++;

        t(() => setProgressPercent(Math.round(turnPct - (57 / totalTurns) * 0.5)), d);

        // Character-by-character typing
        text.split('').forEach((_, i) => {
          t(() => setTypingText(text.slice(0, i + 1)), d + i * typeSpeed);
        });

        // After typing: commit the turn
        t(() => {
          setTypingText('');
          setProgressPercent(Math.round(turnPct));
          setTurns(prev => [...prev, {
            reasoning: text,
            activities: turn.activities,
            phase: 'analyze',
          }]);
          setActiveTurnIndex(thisTurnIndex);
          const newFiles = turn.activities.flatMap(a => a.files).filter(f => f && f !== '.');
          setExaminedFiles(prev => {
            const combined = [...prev, ...newFiles.filter(f => !prev.includes(f))];
            return combined;
          });
          turn.categoriesCovered.forEach((cat, ci) => {
            t(() => setCoveredTopics(prev => new Set([...prev, cat])), ci * 150);
          });
        }, d + typeTime + 50);

        d += typeTime + 120;
        const activityDuration = Math.min(turn.duration, 600);
        t(() => { setActiveTurnIndex(null); }, d + activityDuration);
        d += activityDuration + 80;
      });

      // ── Recording phase ──
      const recordTurnIndex = streamTurnCounter++;
      const totalFindings = allFindings.length;
      const recordText = `Recording ${totalFindings} findings across all categories.`;
      t(() => { setPhase('recording'); setProgressPercent(65); }, d);
      recordText.split('').forEach((_, i) => {
        t(() => setTypingText(recordText.slice(0, i + 1)), d + i * typeSpeed);
      });
      d += recordText.length * typeSpeed + 100;

      // Compute cumulative batch offsets
      const batchCumulative: number[] = [];
      let cumSum = 0;
      for (const bs of findingBatches) { cumSum += bs; batchCumulative.push(cumSum); }

      t(() => {
        setTypingText('');
        const firstBatchEnd = batchCumulative[0] ?? totalFindings;
        setTurns(prev => [...prev, {
          reasoning: recordText,
          activities: [{ label: `record_finding x${firstBatchEnd}`, files: [], detail: `Batch 1: ${firstBatchEnd} findings` }],
          phase: 'write',
        }]);
        setActiveTurnIndex(recordTurnIndex);
      }, d);

      // Finding bursts
      const recordingProgressStart = 65;
      const recordingProgressEnd = 80;
      findingBatches.forEach((_, batchIdx) => {
        const endIdx = batchCumulative[batchIdx];
        const pct = recordingProgressStart + ((batchIdx + 1) / findingBatches.length) * (recordingProgressEnd - recordingProgressStart);
        d += batchIdx === 0 ? 200 : 600;
        t(() => {
          setFindings(allFindings.slice(0, endIdx));
          setProgressPercent(Math.round(pct));
          if (batchIdx > 0) {
            setTurns(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) updated[updated.length - 1] = { ...last, activities: [{ label: `record_finding x${endIdx}`, files: [], detail: `${batchIdx + 1} batches: ${endIdx} findings recorded` }] };
              return updated;
            });
          }
        }, d);
      });
      d += 500;
      t(() => { setActiveTurnIndex(null); setProgressPercent(83); }, d);

      // ── Assembling phase ──
      const assembleTurnIndex = streamTurnCounter++;
      d += 300;
      t(() => { setPhase('assembling'); setProgressPercent(88); }, d);
      const assembleText = 'Assembling comprehensive brief with all required sections.';
      assembleText.split('').forEach((_, i) => {
        t(() => setTypingText(assembleText.slice(0, i + 1)), d + i * typeSpeed);
      });
      d += assembleText.length * typeSpeed + 100;
      t(() => {
        setTypingText('');
        setTurns(prev => [...prev, {
          reasoning: assembleText,
          activities: [{ label: 'auto_assemble', files: [], detail: 'Assembling brief sections and computing scorecard' }],
          phase: 'write',
        }]);
        setActiveTurnIndex(assembleTurnIndex);
      }, d);

      // ── Done ──
      d += 1200;
      t(() => {
        setPhase('done');
        setProgressPercent(100);
        setActiveTurnIndex(null);
        setScoreVisible(true);
        setTurns(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) updated[updated.length - 1] = { ...last, activities: [{ label: 'auto_assemble', files: [], detail: `${totalFindings} findings scored, brief complete` }] };
          return updated;
        });
      }, d);
    }, 50);
  }, [reset, t, allTurns, allFindings, findingBatches]);

  return {
    phase, turns, typingText, activeTurnIndex, coveredTopics,
    examinedFiles, findings, scoreVisible, progressPercent,
    pendingActions: [] as string[],
    run, reset,
  };
}
