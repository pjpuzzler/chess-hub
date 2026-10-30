import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key, Piece, Role } from 'chessground/types';
import { useEffect, useRef, useState } from 'react';
import { boardSide, keepSnapped } from '../lib/pixel';
import type { Side } from '../lib/position';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const EMPTY = '8/8/8/8/8/8/8/8';
const ROLES: Role[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

type Tool = Piece | 'erase' | null;

// Free board editor: drag pieces anywhere, drag one off the board to remove
// it, or pick a spare piece (or the eraser) and tap squares. Compact enough
// for a phone sheet.
export function PositionEditor({
  placement,
  side,
  onChange,
}: {
  placement: string; // FEN piece placement to start from
  side: Side;
  onChange: (placement: string, side: Side) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const toolRef = useRef<Tool>(null);
  const sideRef = useRef(side);
  const onChangeRef = useRef(onChange);
  const initial = useRef(placement);

  useEffect(() => {
    toolRef.current = tool;
    sideRef.current = side;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, {
      fen: initial.current,
      orientation: 'white',
      coordinates: true,
      animation: { duration: 150 },
      highlight: { lastMove: false, check: false },
      movable: { free: true, color: 'both', showDests: false },
      premovable: { enabled: false },
      draggable: { enabled: true, deleteOnDropOff: true, showGhost: true },
      drawable: { enabled: false },
      events: {
        change: () => onChangeRef.current(cg.getFen(), sideRef.current),
      },
    });
    api.current = cg;
    const unsnap = keepSnapped(el.current);
    // With a spare piece or the eraser armed, a tap edits that square and
    // never reaches Chessground (which would start selecting or dragging).
    const host = el.current;
    const onDown = (e: PointerEvent) => {
      const t = toolRef.current;
      if (!t) return;
      const key = cg.getKeyAtDomPos([e.clientX, e.clientY]);
      e.preventDefault();
      e.stopPropagation();
      if (!key) return;
      cg.setPieces(
        new Map<Key, Piece | undefined>([[key, t === 'erase' ? undefined : t]])
      );
      onChangeRef.current(cg.getFen(), sideRef.current);
    };
    host.addEventListener('pointerdown', onDown, { capture: true });
    host.addEventListener('mousedown', stopIfArmed, { capture: true });
    host.addEventListener('touchstart', stopIfArmed, { capture: true });
    function stopIfArmed(e: Event) {
      if (toolRef.current) e.stopPropagation();
    }
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true });
      host.removeEventListener('mousedown', stopIfArmed, { capture: true });
      host.removeEventListener('touchstart', stopIfArmed, { capture: true });
      unsnap();
      cg.destroy();
      api.current = null;
    };
  }, []);

  // The board spans the sheet's width, rounded down to whole px per square.
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const fit = () =>
      node.style.setProperty(
        '--editor-board',
        `${boardSide(Math.min(node.clientWidth, 400))}px`
      );
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const reset = (fen: string) => {
    api.current?.set({ fen });
    onChange(fen, side);
  };

  const spare = (color: 'white' | 'black') => (
    <div
      className="tray"
      role="group"
      aria-label={`${color === 'white' ? 'White' : 'Black'} pieces`}
    >
      {ROLES.map((role) => {
        const on =
          tool !== null &&
          tool !== 'erase' &&
          tool.role === role &&
          tool.color === color;
        return (
          <button
            key={role}
            type="button"
            className={`tray-piece cg-wrap ${on ? 'on' : ''}`}
            aria-label={`Place ${color} ${role}`}
            aria-pressed={on}
            onClick={() => setTool(on ? null : { role, color })}
          >
            <piece className={`${role} ${color}`} />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="editor" ref={box}>
      {spare('black')}
      <div className="editor-board">
        <div ref={el} className="cg-wrap board-cg" />
      </div>
      {spare('white')}
      <div className="editor-tools">
        <button
          type="button"
          className={`chip-btn ${tool === 'erase' ? 'on' : ''}`}
          aria-pressed={tool === 'erase'}
          onClick={() => setTool(tool === 'erase' ? null : 'erase')}
        >
          Erase
        </button>
        <button type="button" className="chip-btn" onClick={() => reset(START)}>
          Start
        </button>
        <button type="button" className="chip-btn" onClick={() => reset(EMPTY)}>
          Clear
        </button>
      </div>
      <div className="editor-side" role="group" aria-label="Side to move">
        <span className="editor-side-label">To move</span>
        {(['white', 'black'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={`chip-btn ${side === c ? 'on' : ''}`}
            aria-pressed={side === c}
            onClick={() => onChange(api.current?.getFen() ?? placement, c)}
          >
            <span className={`disc ${c}`} aria-hidden="true" />
            {c === 'white' ? 'White' : 'Black'}
          </button>
        ))}
      </div>
    </div>
  );
}
