import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { boardSide } from '../lib/pixel';
import { Sheet } from './Sheet';

// Board-first layout that fits the viewport (nothing scrolls, nothing to
// swipe). Phones: status line, board, move strip, a few info rows and the
// bottom bar. Each view reserves the info rows it can ever need
// (`infoRows`), so the board never changes size between states or after
// loading; the board is edge to edge unless the height can't hold that.
// What doesn't fit sits behind a grab bar at the top of the info rows: tap
// it or drag it up for a sheet with the details.
// Wide screens: board left, everything else (details inline) on the right.
const WIDE = '(min-width: 760px)';
const SIDE_W = 340; // wide layout: the right-hand column
const GAP_W = 24;
const MAX_BOARD = 720;
const ROW_H = 30; // the smallest .info-row
const ROW_MAX = 42; // rows grow to this when there's room
const TOP_H = 32; // .screen-top (--top-h)
const INFO_PAD = 4; // .info padding, top and bottom

export function Screen({
  top,
  board,
  evalBar,
  strip,
  summary,
  extra,
  details,
  detailsTitle = 'Details',
  infoRows = 1,
  compact,
  nav,
}: {
  top?: ReactNode; // one line, height reserved so nothing below moves
  board: ReactNode;
  evalBar?: ReactNode;
  strip?: ReactNode; // the move strip row (pass it in every state of a view)
  summary?: ReactNode; // first info row; the Details button sits at its end
  extra?: ReactNode; // further info rows, one .info-row each
  details?: ReactNode; // behind the Details button (inline on wide screens)
  detailsTitle?: string;
  infoRows?: number; // the most info rows this view shows in any state
  // Short screens: the one row that replaces the status line and the info
  // rows, so the board can still span the width.
  compact?: ReactNode;
  nav?: ReactNode; // bottom bar contents
}) {
  const [isCompact, setCompact] = useState(false);
  const hasCompact = compact !== undefined;
  const [openFrom, setOpenFrom] = useState<number | null>(null);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  const root = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const openSheet = (grab: HTMLElement) =>
    setOpenFrom(grab.getBoundingClientRect().top);

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Size the board before paint and on every resize.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const part = (sel: string) =>
        el.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0;
      let size;
      if (window.matchMedia(WIDE).matches) {
        setCompact(false);
        const evalW =
          el.querySelector<HTMLElement>('.screen-board > .eval-bar')
            ?.offsetWidth ?? 0;
        size = Math.min(
          el.clientWidth - SIDE_W - GAP_W - evalW,
          el.clientHeight,
          MAX_BOARD
        );
      } else {
        // Phones: a full-width board first. If the status line and the info
        // rows leave no room for it, fold them into one row (compact). Space
        // left over makes the rows roomier, then spreads evenly around them.
        const full = boardSide(el.clientWidth);
        const around =
          part('.screen-board > .eval-bar') +
          part('.screen-strip') +
          part('.bottom') +
          INFO_PAD * 2;
        const normal = TOP_H + around + infoRows * ROW_H;
        const fold = el.clientHeight - normal < full && hasCompact;
        setCompact(fold);
        const rows = fold ? 1 : infoRows;
        const fixed = (fold ? 0 : TOP_H) + around + rows * ROW_H;
        size = Math.min(el.clientWidth, el.clientHeight - fixed);
        const spare = el.clientHeight - fixed - boardSide(size);
        const rowH = Math.min(ROW_MAX, ROW_H + Math.floor(spare / rows));
        el.style.setProperty('--row-h', `${Math.max(ROW_H, rowH)}px`);
      }
      el.style.setProperty('--board', `${boardSide(size)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const sel of ['.bottom', '.screen-top']) {
      const part = el.querySelector(sel);
      if (part) ro.observe(part);
    }
    return () => ro.disconnect();
  }, [infoRows, hasCompact]);

  return (
    <div ref={root} className={`screen ${nav ? 'has-nav' : ''}`}>
      <div className="screen-board">
        {evalBar}
        <div className="board-box">{board}</div>
      </div>
      <div className="screen-side">
        {isCompact ? null : (
          <div className="screen-top" aria-live="polite">
            {top}
          </div>
        )}
        {strip !== undefined ? (
          <div className="screen-strip">{strip}</div>
        ) : null}
        <div className="info">
          {details && !wide ? (
            <button
              type="button"
              className="grab"
              aria-label={`Show ${detailsTitle.toLowerCase()}`}
              onClick={(e) => openSheet(e.currentTarget)}
              onPointerDown={(e) => {
                // Keep getting moves once the finger leaves the thin bar.
                e.currentTarget.setPointerCapture(e.pointerId);
                dragFrom.current = e.clientY;
              }}
              onPointerMove={(e) => {
                if (
                  dragFrom.current !== null &&
                  dragFrom.current - e.clientY > 16
                ) {
                  dragFrom.current = null;
                  openSheet(e.currentTarget);
                }
              }}
              onPointerUp={() => {
                dragFrom.current = null;
              }}
            >
              <span className="grab-pill" aria-hidden="true" />
            </button>
          ) : null}
          {isCompact ? (
            <div className="info-row" aria-live="polite">
              {compact}
            </div>
          ) : (
            <>
              {summary ? <div className="info-row">{summary}</div> : null}
              {extra}
            </>
          )}
          {details && wide ? (
            <div className="info-details">{details}</div>
          ) : null}
        </div>
        {nav ? (
          <div className="bottom">
            <nav className="navbar" aria-label="Controls">
              {nav}
            </nav>
          </div>
        ) : null}
      </div>
      {openFrom !== null && details && !wide ? (
        <Sheet
          title={detailsTitle}
          fromY={openFrom}
          onClose={() => setOpenFrom(null)}
        >
          <div className="details-sheet">{details}</div>
        </Sheet>
      ) : null}
    </div>
  );
}
