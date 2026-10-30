// Engine wording and line selection shared by the analysis screens.
import type { PvLine, Score } from '../engine/uci';
import { turnOf, type GameEnd } from './chess';

// One name everywhere the engine is credited.
export const ENGINE_LABEL = 'Stockfish 19';

export function endText(end: Exclude<GameEnd, null>, fen: string): string {
  if (end === 'checkmate')
    return `Checkmate. ${turnOf(fen) === 'white' ? 'Black' : 'White'} wins`;
  if (end === 'stalemate') return 'Stalemate';
  return 'Draw';
}

const pawns = (s: Score) =>
  s.mate !== undefined ? (s.mate > 0 ? 1e4 : -1e4) : s.cp;

// Lines worth drawing: the best, plus the second only when it is as good
// (within 0.3 pawns).
export function drawnLines(lines: PvLine[]): PvLine[] {
  const [a, b] = lines;
  if (!a) return [];
  if (b && Math.abs(pawns(a.score) - pawns(b.score)) <= 30) return [a, b];
  return [a];
}
