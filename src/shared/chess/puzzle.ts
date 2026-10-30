// Pure puzzle stepping and validation (Lichess conventions).
// moves[0] is the opponent's setup move; the solver plays moves[1], moves[3], ...
import { Chess } from 'chess.js';

export type Color = 'white' | 'black';

export type UciMove = { from: string; to: string; promotion?: string };

export type StepResult =
  // Wrong move: the position is unchanged, the solver may retry.
  | { kind: 'wrong' }
  // Correct, puzzle continues: `reply` is the opponent's answer, after which
  // it is the solver's turn again at `nextPly`.
  | { kind: 'continue'; reply: string; nextPly: number }
  | { kind: 'solved' };

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function parseUci(uci: string): UciMove | null {
  const m = UCI_RE.exec(uci);
  if (!m || !m[1] || !m[2]) return null;
  return m[3]
    ? { from: m[1], to: m[2], promotion: m[3] }
    : { from: m[1], to: m[2] };
}

// Plays a UCI move on a copy of `fen`. Returns null if it is illegal.
export function playUci(fen: string, uci: string): Chess | null {
  const move = parseUci(uci);
  if (!move) return null;
  const chess = new Chess(fen);
  try {
    chess.move(move);
  } catch {
    return null;
  }
  return chess;
}

function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

// The solver is the side to move after the setup move.
export function solverColor(puzzleFen: string): Color {
  return sideToMove(puzzleFen) === 'white' ? 'black' : 'white';
}

// FEN after the first `ply` moves of the line have been played.
export function fenAtPly(
  puzzleFen: string,
  moves: readonly string[],
  ply: number
): string {
  const chess = new Chess(puzzleFen);
  for (const uci of moves.slice(0, ply)) {
    const move = parseUci(uci);
    if (!move) throw new Error(`bad uci ${uci}`);
    chess.move(move);
  }
  return chess.fen();
}

export function isSolverPly(ply: number): boolean {
  return ply % 2 === 1;
}

// Validates the solver's `uci` at solver ply `ply` (position `fenBefore`).
// Any checkmating move wins, as on Lichess; otherwise the move must match the
// solution exactly (an underpromotion is wrong unless it mates).
export function stepPuzzle(
  moves: readonly string[],
  ply: number,
  fenBefore: string,
  uci: string
): StepResult {
  const after = playUci(fenBefore, uci);
  if (!after) return { kind: 'wrong' };
  if (after.isCheckmate()) return { kind: 'solved' };
  if (uci !== moves[ply]) return { kind: 'wrong' };
  const reply = moves[ply + 1];
  if (reply === undefined) return { kind: 'solved' };
  return { kind: 'continue', reply, nextPly: ply + 2 };
}

// Hint for the solver at `ply`: level 1 highlights the piece, level 2 the move.
export function hintFor(moves: readonly string[], ply: number): UciMove | null {
  const uci = moves[ply];
  return uci ? parseUci(uci) : null;
}
