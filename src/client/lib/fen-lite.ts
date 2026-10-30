// Dependency-free FEN reading for the inline splash (no chess.js there).
export type PieceColor = 'white' | 'black';
export type PlacedPiece = {
  role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
  color: PieceColor;
  file: number; // 0 = a
  rank: number; // 0 = rank 1
};

const ROLES = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
} as const;

function roleOf(ch: string): PlacedPiece['role'] | null {
  switch (ch) {
    case 'p':
    case 'n':
    case 'b':
    case 'r':
    case 'q':
    case 'k':
      return ROLES[ch];
    default:
      return null;
  }
}

export function piecesFromFen(fen: string): PlacedPiece[] {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const pieces: PlacedPiece[] = [];
  placement.split('/').forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const role = roleOf(ch.toLowerCase());
      if (role)
        pieces.push({
          role,
          color: ch === ch.toLowerCase() ? 'black' : 'white',
          file,
          rank,
        });
      file += 1;
    }
  });
  return pieces;
}

export function sideToMove(fen: string): PieceColor {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
}

// Percent offsets of a square on a board seen from `orientation`.
export function squarePosition(
  file: number,
  rank: number,
  orientation: PieceColor
): { left: number; top: number } {
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: col * 12.5, top: row * 12.5 };
}
