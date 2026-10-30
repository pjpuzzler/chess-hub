// Community game: the subreddit plays itself, one voted move a day.
import { Chess } from 'chess.js';

export type GameOutcome = {
  result: '1-0' | '0-1' | '1/2-1/2';
  reason:
    'checkmate' | 'stalemate' | 'threefold' | 'fiftyMove' | 'insufficient';
};

export type Vote = { move: string; seq: number };

/**
 * Winning move from the votes themselves (each carries the order it was
 * cast): most votes wins; a tie goes to the move whose deciding vote (its
 * c-th, for count c) came first. Null when nobody voted.
 */
export const pickWinner = (votes: Vote[]): string | null => {
  const byMove = new Map<string, number[]>();
  for (const v of votes)
    byMove.set(v.move, [...(byMove.get(v.move) ?? []), v.seq]);
  let best: string | null = null;
  let bestCount = 0;
  let bestAt = Infinity;
  for (const [move, seqs] of byMove) {
    seqs.sort((x, y) => x - y);
    const count = seqs.length;
    const at = seqs[count - 1] ?? Infinity;
    if (count > bestCount || (count === bestCount && at < bestAt)) {
      best = move;
      bestCount = count;
      bestAt = at;
    }
  }
  return best;
};

/** Vote value stored per user: "<uci>@<seq>" (seq = order cast). */
export const encodeVote = (move: string, seq: number) => `${move}@${seq}`;
export const decodeVote = (raw: string): Vote | null => {
  const [move, seq] = raw.split('@');
  const n = Number(seq);
  return move && Number.isInteger(n) ? { move, seq: n } : null;
};

/** Replay the game; returns its outcome if it is over, else null. */
export const gameOutcome = (
  startFen: string,
  moves: string[]
): GameOutcome | null => {
  const chess = new Chess(startFen);
  for (const m of moves)
    chess.move({
      from: m.slice(0, 2),
      to: m.slice(2, 4),
      ...(m[4] ? { promotion: m[4] } : {}),
    });
  if (chess.isCheckmate())
    return {
      result: chess.turn() === 'w' ? '0-1' : '1-0',
      reason: 'checkmate',
    };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial())
    return { result: '1/2-1/2', reason: 'insufficient' };
  if (chess.isThreefoldRepetition())
    return { result: '1/2-1/2', reason: 'threefold' };
  if (chess.isDrawByFiftyMoves())
    return { result: '1/2-1/2', reason: 'fiftyMove' };
  return null;
};

const REASON: Record<GameOutcome['reason'], string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  threefold: 'threefold repetition',
  fiftyMove: 'the 50-move rule',
  insufficient: 'insufficient material',
};

/** "White wins by checkmate in 42" / "Draw by stalemate in 37". */
export const outcomeText = (o: GameOutcome, plies: number): string => {
  const moves = Math.ceil(plies / 2);
  const who =
    o.result === '1-0'
      ? 'White wins'
      : o.result === '0-1'
        ? 'Black wins'
        : 'Draw';
  return `${who} by ${REASON[o.reason]} in ${moves}`;
};
