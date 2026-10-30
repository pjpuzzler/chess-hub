import { useEffect, useRef } from 'react';
import { plyLabel } from '../lib/chess';

export type StripMove = {
  san: string;
  glyph?: string | undefined;
  tone?: string | undefined;
};

// One scrollable row of moves ("1. e4 e5 2. Nf3"); the current one stays in view.
export function MoveStrip({
  startFen,
  moves,
  index,
  onSelect,
}: {
  startFen: string;
  moves: StripMove[];
  index: number; // plies played; 0 = start
  onSelect: (index: number) => void;
}) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = ref.current;
    const cur = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list) return;
    if (!cur) {
      if (index === 0) list.scrollLeft = 0;
      return;
    }
    const left = cur.offsetLeft - list.offsetLeft;
    const target = left - list.clientWidth / 2 + cur.offsetWidth / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [index, moves.length]);

  if (moves.length === 0) return null;
  return (
    <ol className="strip" ref={ref} aria-label="Moves">
      {moves.map((m, i) => {
        const { no, white } = plyLabel(startFen, i);
        const showNo = white || i === 0;
        return (
          <li key={i}>
            {showNo ? (
              <span className="strip-no">
                {no}
                {white ? '.' : '…'}
              </span>
            ) : null}
            <button
              type="button"
              className={`strip-move ${i + 1 === index ? 'current' : ''}`}
              aria-current={i + 1 === index}
              onClick={() => onSelect(i + 1)}
            >
              {m.san}
              {m.glyph ? (
                <span className={`glyph ${m.tone ? `c-${m.tone}` : ''}`}>
                  {m.glyph}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
