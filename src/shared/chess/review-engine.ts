// Drives a UCI engine over every position of a game for Game Review. The
// engine is injected (a browser Worker in the app, a child process in Node
// tests), so this exact code is what the regression tests exercise.
import { Chess } from 'chess.js';
import type { EngineScore, ReviewAnalysis, ReviewPosition } from '../api';
import { classifyPly, THRESHOLDS, type Side } from './review';
import { parseInfo, type Score } from './uci';

// A line-oriented UCI connection.
export type UciEngine = {
  send: (cmd: string) => void;
  next: () => Promise<string>; // the next output line (rejects if the engine died)
};

// One combined figure for both passes, 0 to 1, never going backwards.
export type ReviewProgress = { fraction: number };

// A depth-20 re-check costs several depth-16 scan searches (about 8 on
// Stockfish lite with a warm hash), so progress weighs them that way.
const CHECK_COST = 8;

export type ReviewOptions = {
  engineName: string;
  depth: number; // every position
  checkDepth: number; // re-search of positions before a suspected error
  onProgress?: (p: ReviewProgress) => void;
};

const CP_LIMIT = 10_000; // validateAnalysis bound

export function toEngineScore(s: Score): EngineScore {
  if (s.mate !== undefined) return { mate: s.mate };
  return { cp: Math.max(-CP_LIMIT, Math.min(CP_LIMIT, s.cp)) };
}

// Score for a position with no legal moves (White's view). The stored form
// must be a mate against the side to move (validateAnalysis); the UI shows
// "Checkmate" and the result instead of a mate count.
export function terminalScore(fen: string): EngineScore {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { mate: chess.turn() === 'w' ? -1 : 1 };
  return { cp: 0 };
}

async function until(
  engine: UciEngine,
  done: (l: string) => boolean,
  each?: (l: string) => void
): Promise<void> {
  for (;;) {
    const line = await engine.next();
    each?.(line);
    if (done(line)) return;
  }
}

export async function bootEngine(engine: UciEngine): Promise<void> {
  engine.send('uci');
  await until(engine, (l) => l === 'uciok');
  engine.send('setoption name MultiPV value 1');
  engine.send('ucinewgame');
  engine.send('isready');
  await until(engine, (l) => l === 'readyok');
}

export async function searchPosition(
  engine: UciEngine,
  fen: string,
  depth: number
): Promise<ReviewPosition> {
  const chess = new Chess(fen);
  if (chess.moves().length === 0)
    return { score: terminalScore(fen), best: null };
  const white = chess.turn() === 'w';
  const found: { score: Score | null; best: string | null } = {
    score: null,
    best: null,
  };
  engine.send(`position fen ${fen}`);
  engine.send(`go depth ${depth}`);
  await until(
    engine,
    (l) => l.startsWith('bestmove'),
    (l) => {
      const info = parseInfo(l, white);
      if (info && info.multipv === 1) found.score = info.score;
      if (l.startsWith('bestmove')) found.best = l.split(' ')[1] ?? null;
    }
  );
  const { score: s, best: b } = found;
  if (!s || !b || b === '(none)') throw new Error('Engine gave no result');
  // Dead positions must be scored exactly 0 (validateAnalysis spot check).
  return {
    score: chess.isInsufficientMaterial() ? { cp: 0 } : toEngineScore(s),
    best: b,
  };
}

// A move that loses at least an inaccuracy's worth: a deeper look at the
// position before it fixes both the verdict and the "best was" suggestion.
function isSuspect(
  positions: ReviewPosition[],
  moves: string[],
  i: number,
  firstMover: Side
): boolean {
  const before = positions[i];
  const after = positions[i + 1];
  const move = moves[i];
  if (!before || !after || !move || before.best === null) return false;
  const side: Side =
    (i % 2 === 0) === (firstMover === 'white') ? 'white' : 'black';
  return classifyPly(before, after, move, side).loss >= THRESHOLDS.inaccuracy;
}

export async function analyzeGame(
  engine: UciEngine,
  game: { fens: string[]; moves: string[]; firstMover: Side },
  opts: ReviewOptions
): Promise<ReviewAnalysis> {
  await bootEngine(engine);
  const n = game.fens.length;
  let shown = 0;
  const report = (work: number, totalWork: number) => {
    shown = Math.max(shown, Math.min(1, work / Math.max(1, totalWork)));
    opts.onProgress?.({ fraction: shown });
  };
  const positions: ReviewPosition[] = [];
  const check: number[] = [];
  for (const [i, fen] of game.fens.entries()) {
    positions.push(await searchPosition(engine, fen, opts.depth));
    if (i > 0 && isSuspect(positions, game.moves, i - 1, game.firstMover))
      check.push(i - 1);
    // Re-checks still to come, extrapolated from the moves seen so far.
    const seen = Math.max(1, i);
    const expected = i >= 10 ? (check.length * (n - 1)) / seen : check.length;
    report(i + 1, n + CHECK_COST * expected);
  }
  for (const [k, i] of check.entries()) {
    const fen = game.fens[i];
    if (fen) positions[i] = await searchPosition(engine, fen, opts.checkDepth);
    report(n + CHECK_COST * (k + 1), n + CHECK_COST * check.length);
  }
  report(1, 1);
  return { engine: opts.engineName, depth: opts.depth, positions };
}
