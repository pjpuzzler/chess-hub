// Browser side of Game Review and the poll reveal: Stockfish in its own
// Worker, driven by the shared review engine code.
import type {
  EngineScore,
  ReviewAnalysis,
  ReviewPosition,
} from '../../shared/api';
import type { Side } from '../../shared/chess/review';
import {
  analyzeGame,
  bootEngine,
  searchPosition,
  type ReviewProgress,
  type UciEngine,
} from '../../shared/chess/review-engine';
import { ENGINE_NAME, ENGINE_URL } from './engine';

export { terminalScore, toEngineScore } from '../../shared/chess/review-engine';
export type { EngineScore };

// Depth 16 everywhere plus depth 20 before each suspected error. An iPhone
// reviewed a full game at 14+18 in ~4 s, so there is room for this.
export const REVIEW_DEPTH = 16;
export const CHECK_DEPTH = 20;
const BOOT_TIMEOUT_MS = 15_000;

export type BatchProgress = ReviewProgress;

// A Worker as a line-oriented UCI connection that can be cancelled.
function workerEngine(): { engine: UciEngine; stop: (reason: Error) => void } {
  if (typeof Worker === 'undefined' || typeof WebAssembly !== 'object') {
    throw new Error('Engine unavailable on this device');
  }
  const worker = new Worker(ENGINE_URL);
  const queue: string[] = [];
  let waiting: {
    resolve: (l: string) => void;
    reject: (e: Error) => void;
  } | null = null;
  let dead: Error | null = null;
  const stop = (reason: Error) => {
    if (dead) return;
    dead = reason;
    worker.terminate();
    waiting?.reject(reason);
    waiting = null;
  };
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (typeof e.data !== 'string') return;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.resolve(e.data);
    } else queue.push(e.data);
  });
  worker.addEventListener('error', () =>
    stop(new Error('Engine unavailable on this device'))
  );
  const boot = setTimeout(
    () => stop(new Error('Engine timed out')),
    BOOT_TIMEOUT_MS
  );
  const engine: UciEngine = {
    send: (cmd) => {
      if (!dead) worker.postMessage(cmd);
    },
    next: () => {
      clearTimeout(boot);
      if (dead) return Promise.reject(dead);
      const line = queue.shift();
      if (line !== undefined) return Promise.resolve(line);
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },
  };
  return { engine, stop };
}

export class BatchAnalyzer {
  private stop: ((reason: Error) => void) | null = null;

  async review(
    game: { fens: string[]; moves: string[]; firstMover: Side },
    onProgress: (p: BatchProgress) => void
  ): Promise<ReviewAnalysis> {
    const started = performance.now();
    const { engine, stop } = workerEngine();
    this.stop = stop;
    try {
      const analysis = await analyzeGame(engine, game, {
        engineName: ENGINE_NAME,
        depth: REVIEW_DEPTH,
        checkDepth: CHECK_DEPTH,
        onProgress,
      });
      console.info(
        `[review] ${game.fens.length} positions in ${Math.round(performance.now() - started)} ms`
      );
      return analysis;
    } finally {
      stop(new Error('done'));
    }
  }

  // Score a handful of positions (the poll reveal).
  async positions(
    fens: string[],
    depth = REVIEW_DEPTH
  ): Promise<ReviewPosition[]> {
    const { engine, stop } = workerEngine();
    this.stop = stop;
    try {
      await bootEngine(engine);
      const out: ReviewPosition[] = [];
      for (const fen of fens)
        out.push(await searchPosition(engine, fen, depth));
      return out;
    } finally {
      stop(new Error('done'));
    }
  }

  cancel(): void {
    this.stop?.(new Error('cancelled'));
  }
}
