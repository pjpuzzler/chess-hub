// Game review: PGN parsing, win%, move classification and accuracy.
import { Chess } from 'chess.js';
import type { EngineScore, ReviewAnalysis, ReviewPosition } from '../api';
import { checkMove } from './poll';

export const MAX_PLIES = 300;

export type Side = 'white' | 'black';

export type ParsedGame = {
  // Movetext without comments or variations, with the headers kept.
  pgn: string;
  white: string;
  black: string;
  result: string;
  // All headers, cleaned and capped (plain text).
  tags: Record<string, string>;
  startFen: string;
  firstMover: Side;
  // Moves in UCI, and the FEN of every position (length = moves.length + 1).
  moves: string[];
  fens: string[];
};

// User-supplied header text is kept as short plain text.
const MAX_NAME = 60;
const MAX_HEADER = 100;
const MAX_HEADERS = 30;
const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const plain = (v: string, max: number) =>
  v.replace(CONTROL, ' ').trim().slice(0, max);

const header = (h: Record<string, string | null>, k: string, d: string) => {
  const v = plain(h[k] ?? '', MAX_NAME);
  return v && v !== '?' ? v : d;
};

/** Parse and normalise a game. Errors come back as a message for the user. */
export const parseGame = (input: string): ParsedGame | { error: string } => {
  if (!input.trim()) return { error: 'Paste a PGN.' };
  let src: Chess;
  try {
    src = new Chess();
    src.loadPgn(input);
  } catch {
    return { error: "That doesn't look like a valid PGN." };
  }
  const history = src.history({ verbose: true });
  if (history.length === 0) return { error: 'That PGN has no moves.' };
  if (history.length > MAX_PLIES)
    return {
      error: `That game has ${history.length} plies; the limit is ${MAX_PLIES}.`,
    };

  const headers = src.getHeaders();
  const startFen = headers['FEN']
    ? new Chess(headers['FEN']).fen()
    : new Chess().fen();
  // Replay on a clean board to drop comments, NAGs and variations.
  const clean = new Chess(startFen);
  const fens = [clean.fen()];
  const moves: string[] = [];
  for (const m of history) {
    clean.move(m.san);
    moves.push(`${m.from}${m.to}${m.promotion ?? ''}`);
    fens.push(clean.fen());
  }
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers).slice(0, MAX_HEADERS))
    if (typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(k)) {
      tags[k] = plain(v, MAX_HEADER);
      clean.setHeader(k, tags[k]);
    }
  return {
    pgn: clean.pgn(),
    white: header(headers, 'White', 'White'),
    black: header(headers, 'Black', 'Black'),
    tags,
    result: RESULTS.includes(headers['Result'] ?? '')
      ? (headers['Result'] ?? '*')
      : '*',
    startFen,
    firstMover: new Chess(startFen).turn() === 'w' ? 'white' : 'black',
    moves,
    fens,
  };
};

// ---------------------------------------------------------------- win% ----

/** Win probability (0-100) for White. Mates count as a certain result. */
export const winPercent = (s: EngineScore): number => {
  if ('mate' in s) return s.mate > 0 ? 100 : 0;
  // Lichess: https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/WinPercent.scala
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * s.cp)) - 1);
};

const forSide = (whitePct: number, side: Side) =>
  side === 'white' ? whitePct : 100 - whitePct;

// -------------------------------------------------------- classification ----

export type MoveClass =
  | 'brilliant'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missedMate';

export const MOVE_CLASSES: MoveClass[] = [
  'brilliant',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
  'missedMate',
];

/**
 * Thresholds on the mover's win% loss (0-100 scale).
 * Lichess judges losses in winning chances on a [-1, 1] scale: inaccuracy 0.1,
 * mistake 0.2, blunder 0.3 (lila Advice.scala). One chance unit is 50 win%
 * points, so those are 5, 10 and 15 win% points. "excellent" (< 2) and "good"
 * (< 5) are our own sub-bands of the non-error moves.
 */
export const THRESHOLDS = {
  excellent: 2,
  inaccuracy: 5,
  mistake: 10,
  blunder: 15,
  // Mover's win% after the move at or above which ?! and ? are not given.
  clearlyWinning: 90,
} as const;

export type ClassifiedPly = {
  ply: number; // 1-based
  side: Side;
  move: string;
  cls: MoveClass;
  loss: number; // win% points lost by the mover, >= 0
};

const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');

/** Does `score` hold a forced mate in `side`'s favour? */
const matesFor = (score: EngineScore, side: Side) =>
  'mate' in score && (side === 'white' ? score.mate > 0 : score.mate < 0);

export const classifyPly = (
  before: ReviewPosition,
  after: ReviewPosition,
  played: string,
  side: Side
): { cls: MoveClass; loss: number } => {
  const loss = Math.max(
    0,
    forSide(winPercent(before.score), side) -
      forSide(winPercent(after.score), side)
  );
  if (matesFor(before.score, side) && !matesFor(after.score, side))
    return { cls: 'missedMate', loss };
  // A big loss beats the engine's pick: a shallow search can name the played
  // move "best" and only see the refutation one ply later (8...Nxe4?? in
  // Reti-Tartakower). Smaller drops after the engine's own move are depth
  // noise, so the pick stands.
  if (loss >= THRESHOLDS.blunder) return { cls: 'blunder', loss };
  if (played === before.best) return { cls: 'best', loss };
  // No ?! or ? while the mover stays clearly winning (24.Rxd4 in
  // Kasparov-Topalov): the move kept the win, the engine just liked another.
  const stillWinning =
    forSide(winPercent(after.score), side) >= THRESHOLDS.clearlyWinning;
  if (!stillWinning) {
    if (loss >= THRESHOLDS.mistake) return { cls: 'mistake', loss };
    if (loss >= THRESHOLDS.inaccuracy) return { cls: 'inaccuracy', loss };
  }
  if (loss >= THRESHOLDS.excellent) return { cls: 'good', loss };
  return { cls: 'excellent', loss };
};

// -------------------------------------------------------------- accuracy ----

/** Per-move accuracy from the mover's win% before/after (lila AccuracyPercent.scala). */
export const moveAccuracy = (before: number, after: number): number => {
  const diff = Math.max(0, before - after);
  const raw =
    103.1668100711649 * Math.exp(-0.04354415386753951 * diff) -
    3.166924740191411 +
    1; // Lichess's "uncertainty bonus"
  return Math.min(100, Math.max(0, raw));
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdDev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * Game accuracy per side, following lila's AccuracyPercent.gameAccuracy: each
 * move's accuracy is weighted by the volatility (std dev, clamped to 0.5-12)
 * of a sliding window of win%s around it, and the result is the average of
 * the weighted mean and the harmonic mean. null if a side never moved.
 */
export const gameAccuracy = (
  positions: ReviewPosition[],
  firstMover: Side
): Record<Side, number | null> => {
  const pcts = positions.map((p) => winPercent(p.score));
  const plies = pcts.length - 1;
  if (plies < 1) return { white: null, black: null };
  const size = Math.min(8, Math.max(2, Math.floor(plies / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < Math.min(size, pcts.length) - 2; i++)
    windows.push(pcts.slice(0, size));
  for (let i = 0; i + size <= pcts.length; i++)
    windows.push(pcts.slice(i, i + size));
  const weights = windows.map((w) => Math.min(12, Math.max(0.5, stdDev(w))));

  const acc: Record<Side, { a: number; w: number }[]> = {
    white: [],
    black: [],
  };
  for (let i = 0; i < plies; i++) {
    const side = i % 2 === 0 ? firstMover : otherSide(firstMover);
    acc[side].push({
      a: moveAccuracy(
        forSide(pcts[i] ?? 50, side),
        forSide(pcts[i + 1] ?? 50, side)
      ),
      w: weights[i] ?? 0.5,
    });
  }
  const fin = (xs: { a: number; w: number }[]): number | null => {
    if (xs.length === 0) return null;
    const wsum = xs.reduce((s, x) => s + x.w, 0);
    const weighted = xs.reduce((s, x) => s + x.a * x.w, 0) / wsum;
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / x.a, 0);
    return (weighted + harmonic) / 2;
  };
  return { white: fin(acc.white), black: fin(acc.black) };
};

export type ReviewSummary = {
  plies: ClassifiedPly[];
  accuracy: Record<Side, number | null>;
  counts: Record<Side, Record<MoveClass, number>>;
};

const emptyCounts = (): Record<MoveClass, number> => ({
  brilliant: 0,
  best: 0,
  excellent: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  missedMate: 0,
});

// ------------------------------------------------------------ brilliant ----
//
// Our own conservative "!!" rule. Engines don't label brilliance, and sites
// that do use private heuristics. Ours is a plain definition with no
// special cases, and errs towards rarely awarding it:
//
// 1. Sound: the played move is within 2 win% of the engine's best.
// 2. A real sacrifice of the moved piece: taking it leaves the mover at
//    least 2 pawns worse off than the opponent's best other capture (short
//    capture-only search, either side may stop capturing). Leaving some
//    other piece hanging, before or after the move, doesn't count.
// 3. It mattered: the mover was not already winning (< 90% before) and is
//    at least level afterwards (>= 50%).
// 4. Not opening theory (first 8 plies) and not a recapture on the square
//    the opponent just captured on.

export const BRILLIANT = {
  maxLoss: 2, // win%
  minSacrifice: 2, // pawns
  maxBefore: 90, // win%
  minAfter: 50, // win%
  bookPlies: 8,
} as const;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Material balance (pawns) from `side`'s point of view.
function balance(chess: Chess, side: 'w' | 'b'): number {
  let n = 0;
  for (const row of chess.board())
    for (const sq of row)
      if (sq) n += (sq.color === side ? 1 : -1) * (VALUE[sq.type] ?? 0);
  return n;
}

// Capture-only minimax with stand-pat, `depth` plies deep. Returns the
// material balance for `side` with best play by both.
function quiesce(chess: Chess, side: 'w' | 'b', depth: number): number {
  const stand = balance(chess, side);
  if (depth === 0) return stand;
  const maximizing = chess.turn() === side;
  let best = stand;
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    chess.move(m);
    const v = quiesce(chess, side, depth - 1);
    chess.undo();
    best = maximizing ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/**
 * Material the mover loses by force because the opponent can take the piece
 * that just moved (pawns, >= 0): the result of taking it, compared with the
 * material before the move and with the opponent's best capture elsewhere
 * (or no capture). Pieces that were already hanging don't count.
 */
export const sacrificedMaterial = (fenBefore: string, move: string): number => {
  if (!checkMove(fenBefore, move)) return 0;
  const chess = new Chess(fenBefore);
  const side = chess.turn();
  const start = balance(chess, side);
  const target = move.slice(2, 4);
  chess.move({
    from: move.slice(0, 2),
    to: move.slice(2, 4),
    ...(move[4] ? { promotion: move[4] } : {}),
  });
  let ignore = balance(chess, side); // the opponent may also not capture
  let take = Infinity;
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    chess.move(m);
    const v = quiesce(chess, side, 3);
    chess.undo();
    if (m.to === target) take = Math.min(take, v);
    else ignore = Math.min(ignore, v);
  }
  // Measured from the better of the material before the move and what the
  // opponent gets by not taking, so a capture that is taken back at a loss
  // (an exchange sacrifice) counts only its net cost.
  return take === Infinity ? 0 : Math.max(0, Math.min(start, ignore) - take);
};

export const isBrilliant = (opts: {
  fenBefore: string;
  move: string;
  // The opponent's previous move (UCI) and the position it was played in.
  prev: { fenBefore: string; move: string } | null;
  ply: number; // 1-based
  before: ReviewPosition;
  after: ReviewPosition;
  side: Side;
  loss: number;
}): boolean => {
  const { fenBefore, move, prev, ply, before, after, side, loss } = opts;
  if (ply <= BRILLIANT.bookPlies || loss > BRILLIANT.maxLoss) return false;
  if (forSide(winPercent(before.score), side) >= BRILLIANT.maxBefore)
    return false;
  if (forSide(winPercent(after.score), side) < BRILLIANT.minAfter) return false;
  // A recapture: the opponent just captured on the square we capture on.
  if (
    prev &&
    prev.move.slice(2, 4) === move.slice(2, 4) &&
    checkMove(prev.fenBefore, prev.move)?.san.includes('x') &&
    checkMove(fenBefore, move)?.san.includes('x')
  )
    return false;
  return sacrificedMaterial(fenBefore, move) >= BRILLIANT.minSacrifice;
};

/**
 * Classify every move of a game and summarise per side. With `fens` (one per
 * position, as from parseGame) sound sacrifices are also marked brilliant.
 */
export const summarizeReview = (
  positions: ReviewPosition[],
  moves: string[],
  firstMover: Side,
  fens?: string[]
): ReviewSummary => {
  const counts = { white: emptyCounts(), black: emptyCounts() };
  const plies: ClassifiedPly[] = [];
  moves.forEach((move, i) => {
    const before = positions[i];
    const after = positions[i + 1];
    if (!before || !after) return;
    const side = i % 2 === 0 ? firstMover : otherSide(firstMover);
    const classified = classifyPly(before, after, move, side);
    let cls = classified.cls;
    const fenBefore = fens?.[i];
    if (
      fenBefore &&
      (cls === 'best' || cls === 'excellent') &&
      isBrilliant({
        fenBefore,
        move,
        prev:
          i > 0 && fens?.[i - 1] && moves[i - 1]
            ? { fenBefore: fens?.[i - 1] ?? '', move: moves[i - 1] ?? '' }
            : null,
        ply: i + 1,
        before,
        after,
        side,
        loss: classified.loss,
      })
    )
      cls = 'brilliant';
    counts[side][cls]++;
    plies.push({ ply: i + 1, side, move, cls, loss: classified.loss });
  });
  return { plies, accuracy: gameAccuracy(positions, firstMover), counts };
};

// ------------------------------------------------------------ validation ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const parseScore = (v: unknown): EngineScore | null => {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1) return null;
  const { cp, mate } = v;
  if (typeof cp === 'number' && Number.isFinite(cp) && Math.abs(cp) <= 10000)
    return { cp };
  if (
    typeof mate === 'number' &&
    Number.isInteger(mate) &&
    mate !== 0 &&
    Math.abs(mate) <= 500
  )
    return { mate };
  return null;
};

/**
 * Strictly validate a client-submitted analysis against the game's positions.
 * Returns a rebuilt object (extra fields dropped) or an error message.
 */
export const validateAnalysis = (
  input: unknown,
  fens: string[]
): ReviewAnalysis | { error: string } => {
  if (!isRecord(input)) return { error: 'Analysis must be an object.' };
  const { engine, depth, positions } = input;
  if (typeof engine !== 'string' || engine.length === 0 || engine.length > 40)
    return { error: 'engine must be a string of 1-40 characters.' };
  if (
    typeof depth !== 'number' ||
    !Number.isInteger(depth) ||
    depth < 8 ||
    depth > 40
  )
    return { error: 'depth must be an integer from 8 to 40.' };
  if (!Array.isArray(positions) || positions.length !== fens.length)
    return { error: `positions must have ${fens.length} entries.` };

  const out: ReviewPosition[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p: unknown = positions[i];
    const fen = fens[i] ?? '';
    if (!isRecord(p)) return { error: `positions[${i}] must be an object.` };
    const score = parseScore(p['score']);
    if (!score) return { error: `positions[${i}].score is invalid.` };
    const best = p['best'];
    const chess = new Chess(fen);
    const terminal = chess.moves().length === 0;
    // Spot checks the engine cannot get wrong. Checkmate: the side to move
    // has been mated, so the score (White's view) must be a mate against it:
    // mate < 0 when White is mated, > 0 when Black is (any magnitude; we do
    // not accept "mate 0"). Stalemate and dead positions are exactly 0 cp.
    if (chess.isCheckmate()) {
      const mated = chess.turn() === 'w' ? -1 : 1;
      if (!('mate' in score) || Math.sign(score.mate) !== mated)
        return { error: `positions[${i}] is checkmate; score must be a mate.` };
    } else if (chess.isStalemate() || chess.isInsufficientMaterial()) {
      if (!('cp' in score) || score.cp !== 0)
        return { error: `positions[${i}] is a draw; score must be cp 0.` };
    }
    if (best === null) {
      if (!terminal)
        return { error: `positions[${i}].best is required (game not over).` };
      out.push({ score, best: null });
    } else {
      if (typeof best !== 'string' || terminal)
        return { error: `positions[${i}].best is invalid.` };
      const checked = checkMove(fen, best);
      if (!checked || checked.uci !== best)
        return { error: `positions[${i}].best is not a legal move.` };
      out.push({ score, best });
    }
  }
  return { engine, depth, positions: out };
};
