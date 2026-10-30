// Board-editor positions: turn a piece placement + side to move into a FEN
// and check it's a legal position before posting.
import { Chess } from 'chess.js';
import { piecesFromFen } from './fen-lite';

export type Side = 'white' | 'black';

// Castling rights the placement still allows (king and rook on home squares).
function castling(placement: string): string {
  const at = new Map<string, string>();
  for (const p of piecesFromFen(`${placement} w - - 0 1`)) {
    const sq = `${String.fromCharCode(97 + p.file)}${p.rank + 1}`;
    const ch = {
      pawn: 'p',
      knight: 'n',
      bishop: 'b',
      rook: 'r',
      queen: 'q',
      king: 'k',
    }[p.role];
    at.set(sq, p.color === 'white' ? ch.toUpperCase() : ch);
  }
  let out = '';
  if (at.get('e1') === 'K') {
    if (at.get('h1') === 'R') out += 'K';
    if (at.get('a1') === 'R') out += 'Q';
  }
  if (at.get('e8') === 'k') {
    if (at.get('h8') === 'r') out += 'k';
    if (at.get('a8') === 'r') out += 'q';
  }
  return out || '-';
}

export function editorFen(placement: string, side: Side): string {
  return `${placement} ${side === 'white' ? 'w' : 'b'} ${castling(placement)} - 0 1`;
}

// null when fine, otherwise a short reason for the person editing.
export function positionProblem(placement: string, side: Side): string | null {
  const pieces = piecesFromFen(`${placement} w - - 0 1`);
  const kings = (c: Side) =>
    pieces.filter((p) => p.role === 'king' && p.color === c).length;
  if (kings('white') !== 1 || kings('black') !== 1)
    return 'Each side needs exactly one king';
  if (pieces.some((p) => p.role === 'pawn' && (p.rank === 0 || p.rank === 7))) {
    return 'Pawns can’t stand on the first or last rank';
  }
  const other = side === 'white' ? 'black' : 'white';
  let chess: Chess;
  try {
    // The side not to move must not be in check.
    if (
      new Chess(editorFen(placement, other), { skipValidation: true }).inCheck()
    ) {
      return `${other === 'white' ? 'White' : 'Black'} is in check but it’s not their move`;
    }
    chess = new Chess(editorFen(placement, side));
  } catch {
    return 'That position isn’t legal';
  }
  if (chess.moves().length === 0)
    return chess.inCheck() ? 'That’s already checkmate' : 'That’s stalemate';
  return null;
}
