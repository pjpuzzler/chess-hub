// Boards look right only when every square edge falls on a device pixel:
// a side that is 8 x a whole number of device px, and a top-left corner
// on a whole px. Centring in an odd-width container leaves half a pixel,
// which blurs every square edge and shows a sliver of background at one side.

/**
 * The largest side <= `available` whose squares are whole device pixels
 * (8 x a whole number of device px), so a phone's board can span the full
 * width (392 of 393, 429.3 of 430 px at 3x). Layout keeps sizes in 1/64 px,
 * so the side is rounded up to that (under 1/50 of a device pixel): rounded
 * down, Chessground's own floor to 8 device px would lose a whole step.
 */
export function boardSide(available: number): number {
  const dpr = window.devicePixelRatio || 1;
  const side = (Math.floor((available * dpr) / 8) * 8) / dpr;
  return Math.max(0, Math.min(available, Math.ceil(side * 64) / 64));
}

/**
 * Nudges a position: relative `el` so its top-left sits on a whole px. It
 * uses left/top, not a transform: WebKit paints a transformed layer at its
 * old subpixel spot and blends the edge column.
 */
export function snapToPixels(el: HTMLElement): void {
  el.style.left = '';
  el.style.top = '';
  const r = el.getBoundingClientRect();
  const dx = Math.round(r.left) - r.left;
  const dy = Math.round(r.top) - r.top;
  if (Math.abs(dx) > 0.001) el.style.left = `${dx}px`;
  if (Math.abs(dy) > 0.001) el.style.top = `${dy}px`;
}

/**
 * Keeps `el` snapped while things around it move: resizes, scrolling and
 * the end of sheet animations. Returns the cleanup.
 */
export function keepSnapped(el: HTMLElement): () => void {
  let frame = 0;
  const snap = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => snapToPixels(el));
  };
  snapToPixels(el);
  const ro = new ResizeObserver(snap);
  ro.observe(el);
  if (el.parentElement) ro.observe(el.parentElement);
  window.addEventListener('resize', snap);
  document.addEventListener('scroll', snap, { capture: true, passive: true });
  document.addEventListener('animationend', snap, { capture: true });
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    window.removeEventListener('resize', snap);
    document.removeEventListener('scroll', snap, { capture: true });
    document.removeEventListener('animationend', snap, { capture: true });
  };
}
