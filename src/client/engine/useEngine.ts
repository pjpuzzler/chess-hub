import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineStatus } from './engine';
import type { PvLine } from './uci';

export type EngineState = {
  status: EngineStatus;
  lines: PvLine[]; // for `fen` only; empty until the first info line
  depth: number;
};

const UI_THROTTLE_MS = 120;

// Runs Stockfish on `fen` while `enabled` (and `fen` is not null). The worker
// boots lazily on first enable, pauses while the page is hidden, and is
// terminated on unmount.
export function useEngine(fen: string | null, enabled: boolean): EngineState {
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [result, setResult] = useState<{ fen: string; lines: PvLine[] } | null>(
    null
  );
  const latest = useRef<{ fen: string; lines: PvLine[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      engineRef.current?.destroy();
      engineRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      engineRef.current?.stop();
      return;
    }
    if (!engineRef.current) {
      engineRef.current = new Engine({
        onStatus: setStatus,
        onLines: (lineFen, lines) => {
          latest.current = { fen: lineFen, lines };
          if (timer.current !== undefined) return;
          timer.current = setTimeout(() => {
            timer.current = undefined;
            setResult(latest.current);
          }, UI_THROTTLE_MS);
        },
      });
      engineRef.current.boot();
    }
    const engine = engineRef.current;
    const run = () => {
      if (document.visibilityState === 'hidden' || !fen) engine.stop();
      else engine.analyze(fen);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [enabled, fen]);

  const lines = result && result.fen === fen ? result.lines : [];
  return {
    status,
    lines: [...lines].sort((a, b) => a.multipv - b.multipv),
    depth: lines.reduce(
      (d, l) => Math.max(d, l.multipv === 1 ? l.depth : 0),
      0
    ),
  };
}
