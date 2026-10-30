import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Color, Key } from 'chessground/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { destsOf, inCheck, playMove, turnOf } from '../lib/chess';
import { keepSnapped } from '../lib/pixel';
import { sound, soundForSan } from '../lib/sound';

type Props = {
  fen: string;
  orientation: Color;
  lastMove?: [Key, Key] | undefined;
  // The side to move may move pieces (tap or drag).
  interactive: boolean;
  shapes?: DrawShape[] | undefined;
  highlights?: Map<Key, string> | undefined;
  onMove?: ((uci: string) => void) | undefined;
  label?: string;
  sounds?: boolean; // move sounds when the position advances by lastMove
};

type Pending = { from: Key; to: Key; color: Color };

// One arrow style everywhere: same width, colour for meaning, opacity for
// rank (engine line 1 vs 2). Width reads well on a 375px board.
const ARROW = 11;
const BRUSHES: DrawBrushes = {
  green: { key: 'g', color: '#15781B', opacity: 0.8, lineWidth: ARROW },
  red: { key: 'r', color: '#882020', opacity: 0.8, lineWidth: ARROW },
  blue: { key: 'b', color: '#003088', opacity: 0.8, lineWidth: ARROW },
  yellow: { key: 'y', color: '#e68f00', opacity: 0.8, lineWidth: ARROW },
  paleBlue: { key: 'pb', color: '#003088', opacity: 0.35, lineWidth: ARROW },
  paleGreen: { key: 'pg', color: '#15781B', opacity: 0.35, lineWidth: ARROW },
  paleRed: { key: 'pr', color: '#882020', opacity: 0.35, lineWidth: ARROW },
  paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: ARROW },
  purple: { key: 'purple', color: '#68217a', opacity: 0.65, lineWidth: ARROW },
  pink: { key: 'pink', color: '#ee2080', opacity: 0.5, lineWidth: ARROW },
  white: { key: 'white', color: 'white', opacity: 1, lineWidth: ARROW },
  engine1: { key: 'e1', color: '#1f5fbf', opacity: 0.85, lineWidth: ARROW },
  engine2: { key: 'e2', color: '#1f5fbf', opacity: 0.35, lineWidth: ARROW },
};

const PROMOTIONS = [
  ['q', 'queen'],
  ['n', 'knight'],
  ['r', 'rook'],
  ['b', 'bishop'],
] as const;

// Chessground wrapper. The parent owns the position: after a user move it
// should update `fen`; if it doesn't (move rejected), the board snaps back.
export function Board({
  fen,
  orientation,
  lastMove,
  interactive,
  shapes,
  highlights,
  onMove,
  label,
  sounds = true,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const fenRef = useRef(fen);
  const orientationRef = useRef(orientation);
  const onMoveRef = useRef(onMove);
  const [pending, setPending] = useState<Pending | null>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);

  // Move focus into the promotion dialog when it opens.
  useEffect(() => {
    if (pending) firstChoice.current?.focus();
  }, [pending]);

  const turn = turnOf(fen);
  const dests = useMemo(
    () => (interactive ? destsOf(fen) : new Map()),
    [fen, interactive]
  );
  const check = useMemo(() => inCheck(fen), [fen]);

  useEffect(() => {
    fenRef.current = fen;
    onMoveRef.current = onMove;
  });

  const emit = (uci: string, fenAtMove: string) => {
    onMoveRef.current?.(uci);
    // Give React a frame to commit the parent's new position; if the parent
    // ignored the move, restore the board.
    requestAnimationFrame(() => {
      if (fenRef.current === fenAtMove)
        api.current?.set({ fen: fenAtMove, lastMove: [] });
    });
  };

  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, {
      // Start on the real position so nothing animates in from the default.
      fen: fenRef.current,
      orientation: orientationRef.current,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      drawable: {
        enabled: true,
        visible: true,
        eraseOnClick: true,
        brushes: BRUSHES,
      },
      coordinates: true,
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const piece = cg.state.pieces.get(dest);
            const fenAtMove = fenRef.current;
            if (
              piece?.role === 'pawn' &&
              (dest[1] === '8' || dest[1] === '1')
            ) {
              setPending({ from: orig, to: dest, color: piece.color });
              return;
            }
            emit(`${orig}${dest}`, fenAtMove);
          },
        },
      },
    });
    api.current = cg;
    return () => {
      cg.destroy();
      api.current = null;
    };
    // `emit` reads refs only; the board is created once.
  }, []);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const config: Config = {
      fen,
      orientation,
      turnColor: turn,
      check: check ? turn : false,
      lastMove: lastMove ?? [],
      movable: interactive ? { color: turn, dests } : {},
      highlight: { custom: highlights ?? new Map() },
    };
    cg.set(config);
    if (!interactive) {
      // Chessground merges config, so clearing the movable side means deleting it.
      delete cg.state.movable.color;
      delete cg.state.movable.dests;
      cg.selectSquare(null);
    }
  }, [fen, orientation, turn, check, lastMove, interactive, dests, highlights]);

  useEffect(() => {
    api.current?.setAutoShapes(shapes ?? []);
  }, [shapes]);

  useEffect(() => (shell.current ? keepSnapped(shell.current) : undefined), []);

  // A sound when the position moves forward by the highlighted move.
  const prevFen = useRef(fen);
  useEffect(() => {
    const before = prevFen.current;
    prevFen.current = fen;
    if (!sounds || before === fen || !lastMove) return;
    const uci = `${lastMove[0]}${lastMove[1]}`;
    const m = playMove(before, uci) ?? playMove(before, `${uci}q`);
    if (m && m.fen.split(' ')[0] === fen.split(' ')[0])
      sound(soundForSan(m.san));
  }, [fen, lastMove, sounds]);

  const choose = (role: string | null) => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (role) emit(`${p.from}${p.to}${role}`, fenRef.current);
    else api.current?.set({ fen: fenRef.current });
  };

  // Promotion picker sits over the promotion file, growing from the edge.
  let picker = null;
  if (pending) {
    const file = pending.to.charCodeAt(0) - 97;
    const col = orientation === 'white' ? file : 7 - file;
    const fromTop = (pending.to[1] === '8') === (orientation === 'white');
    picker = (
      <div
        className="promo-overlay"
        onClick={() => choose(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') choose(null);
        }}
      >
        <div
          className="promo-picker"
          role="dialog"
          aria-label="Choose promotion piece"
          style={{
            left: `${col * 12.5}%`,
            ...(fromTop ? { top: 0 } : { bottom: 0 }),
            flexDirection: fromTop ? 'column' : 'column-reverse',
          }}
        >
          {PROMOTIONS.map(([code, role]) => (
            <button
              key={code}
              ref={code === 'q' ? firstChoice : undefined}
              type="button"
              className="promo-choice cg-wrap"
              aria-label={`Promote to ${role}`}
              onClick={(e) => {
                e.stopPropagation();
                choose(code);
              }}
            >
              <piece className={`${role} ${pending.color}`} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={shell}
      className="board-shell"
      aria-label={label ?? 'Chess board'}
      role="group"
    >
      <div ref={el} className="cg-wrap board-cg" />
      {picker}
    </div>
  );
}
