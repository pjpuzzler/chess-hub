import type { MouseEvent } from 'react';
import type { MoveClass } from '../../shared/chess/review';

type Mark = { ply: number; cls: MoveClass };

// White's win% across the game (Lichess-style area chart). Click to jump.
export function WinGraph({
  pcts,
  ply,
  marks,
  onSelect,
}: {
  pcts: number[]; // index = ply, 0..100 for White
  ply: number;
  marks: Mark[];
  onSelect: (ply: number) => void;
}) {
  const n = pcts.length;
  const W = 1000;
  const H = 100;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (p: number) => H - p;
  const line = pcts
    .map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`)
    .join(' ');
  const area = `0,${H} ${line} ${W},${H}`;

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSelect(Math.round(t * (n - 1)));
  };

  return (
    <div
      className="win-graph"
      onClick={pick}
      role="img"
      aria-label="White’s winning chances across the game. Click to jump to a move."
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon className="wg-white" points={area} />
        <line className="wg-mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        <polyline className="wg-line" points={line} />
        <line className="wg-cursor" x1={x(ply)} y1="0" x2={x(ply)} y2={H} />
      </svg>
      {marks.map((m) => (
        <span
          key={m.ply}
          className={`wg-mark c-${m.cls}`}
          style={{
            left: `${(x(m.ply) / W) * 100}%`,
            top: `${y(pcts[m.ply] ?? 50)}%`,
          }}
        />
      ))}
    </div>
  );
}
