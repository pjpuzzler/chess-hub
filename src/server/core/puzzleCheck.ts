// Pure puzzle line checking. The full solution only lives on the server.
import { Chess } from 'chess.js';
import type { PuzzleData } from './store';

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

const play = (chess: Chess, uci: string): boolean => {
  const m = UCI.exec(uci);
  if (!m) return false;
  try {
    chess.move({
      from: m[1] ?? '',
      to: m[2] ?? '',
      ...(m[3] ? { promotion: m[3] } : {}),
    });
    return true;
  } catch {
    return false;
  }
};

export const solverMoveCount = (p: PuzzleData): number => p.moves.length / 2;

export type LineCheck =
  | { kind: 'invalid' } // malformed, illegal, or an earlier move was wrong
  | { kind: 'wrong' }
  | { kind: 'correct'; done: boolean; reply: string | null };

/**
 * Check the solver's line (all their moves so far, newest last). Earlier
 * moves must match the solution exactly; the newest may also be any mate when
 * it is the final move (as on Lichess).
 */
export const checkLine = (p: PuzzleData, moves: string[]): LineCheck => {
  const total = solverMoveCount(p);
  if (moves.length === 0 || moves.length > total) return { kind: 'invalid' };
  const chess = new Chess(p.fen);
  if (!play(chess, p.moves[0] ?? '')) return { kind: 'invalid' };
  for (let k = 0; k < moves.length - 1; k++) {
    if (moves[k] !== p.moves[1 + 2 * k]) return { kind: 'invalid' };
    play(chess, p.moves[1 + 2 * k] ?? '');
    play(chess, p.moves[2 + 2 * k] ?? '');
  }
  const k = moves.length - 1;
  const last = moves[k] ?? '';
  const done = k === total - 1;
  if (last === p.moves[1 + 2 * k])
    return {
      kind: 'correct',
      done,
      reply: done ? null : (p.moves[2 + 2 * k] ?? null),
    };
  if (!play(chess, last)) return { kind: 'invalid' };
  if (done && chess.isCheckmate())
    return { kind: 'correct', done, reply: null };
  return { kind: 'wrong' };
};

/** Next solver move after a correct prefix, or null if the prefix is bad. */
export const nextMove = (p: PuzzleData, moves: string[]): string | null => {
  if (moves.length >= solverMoveCount(p)) return null;
  for (let k = 0; k < moves.length; k++)
    if (moves[k] !== p.moves[1 + 2 * k]) return null;
  return p.moves[1 + 2 * moves.length] ?? null;
};
