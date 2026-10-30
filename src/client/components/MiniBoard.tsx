import { useEffect, useRef } from 'react';
import { piecesFromFen, sideToMove, squarePosition } from '../lib/fen-lite';
import { keepSnapped } from '../lib/pixel';

// Static board picture (no Chessground), e.g. for previews in sheets.
export function MiniBoard({
  fen,
  orientation = 'white',
  size = 120,
}: {
  fen: string;
  orientation?: 'white' | 'black';
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? keepSnapped(ref.current) : undefined), []);
  return (
    <div
      ref={ref}
      className="mini-board cg-wrap"
      style={{ width: size }}
      role="img"
      aria-label={`Position, ${sideToMove(fen) === 'white' ? 'White' : 'Black'} to move`}
    >
      {piecesFromFen(fen).map((p, i) => {
        const pos = squarePosition(p.file, p.rank, orientation);
        return (
          <piece
            key={i}
            className={`${p.role} ${p.color}`}
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
          />
        );
      })}
    </div>
  );
}
