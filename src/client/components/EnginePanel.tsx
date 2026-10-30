import type { Color } from 'chessground/types';
import type { EngineState } from '../engine/useEngine';
import { formatScore } from '../engine/uci';
import { ENGINE_LABEL, endText } from '../lib/engine-text';
import { playMove, pvToSan, type GameEnd } from '../lib/chess';

// `share` is White's share of the bar (0..1); null shows a dimmed, even bar.
export function EvalBar({
  share,
  label,
  orientation,
  hidden = false,
}: {
  share: number | null;
  label: string;
  orientation: Color;
  hidden?: boolean; // keeps its space (nothing moves when it appears)
}) {
  const value = share ?? 0.5;
  // A sliver of each side always shows, so a won position still reads as a
  // bar and not an empty box.
  const shown = Math.min(0.97, Math.max(0.03, value));
  return (
    <div
      className={`eval-bar ${orientation === 'black' ? 'flipped' : ''} ${share === null ? 'off' : ''} ${hidden ? 'hidden' : ''}`}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={label || 'No evaluation'}
    >
      {/* Both sizes inline; the CSS keeps the one for the bar's direction. */}
      <div
        className="eval-white"
        style={{ width: `${shown * 100}%`, height: `${shown * 100}%` }}
      />
    </div>
  );
}

// Summary row for the analysis screen: "Stockfish 19 · depth 18".
export function EngineSummary({
  fen,
  engine,
  end,
}: {
  fen: string;
  engine: EngineState;
  end: GameEnd;
}) {
  if (end) return <span className="engine-sum">{endText(end, fen)}</span>;
  if (engine.status === 'unavailable')
    return (
      <span className="engine-sum muted">
        Engine unavailable on this device
      </span>
    );
  const best = engine.lines[0];
  if (!best)
    return (
      <span className="engine-sum muted">{ENGINE_LABEL} is thinking…</span>
    );
  // The eval is on the line row below; this row just says who and how deep.
  return (
    <span className="engine-sum muted">
      {ENGINE_LABEL} · depth {engine.depth}
    </span>
  );
}

// All lines, compact, tap to play the first move. In r/AnarchyChess an
// engine line that starts with en passant gets its due.
export function EngineLines({
  fen,
  engine,
  onPlay,
  anarchy,
  from = 0,
  count = 3,
  plies = 6,
}: {
  fen: string;
  engine: EngineState;
  onPlay: (uci: string) => void;
  anarchy: boolean;
  from?: number;
  count?: number;
  plies?: number; // moves shown per line
}) {
  const lines = engine.lines.slice(from, from + count);
  if (lines.length === 0) return null;
  return (
    <>
      <ul className="pv-list" aria-label="Engine lines" data-rows="">
        {lines.map((l) => {
          const first = l.pv[0];
          const holy =
            anarchy &&
            first !== undefined &&
            playMove(fen, first)?.enPassant === true;
          return (
            <li key={l.multipv}>
              <button
                type="button"
                className="pv"
                onClick={() => first && onPlay(first)}
              >
                <span className="pv-eval">{formatScore(l.score)}</span>
                <span className="pv-moves">{pvToSan(fen, l.pv, plies)}</span>
                {holy ? <span className="pv-tag">Holy hell</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
