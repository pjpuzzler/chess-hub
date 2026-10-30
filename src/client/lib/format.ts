// Small, dependency-free formatting helpers (shared by splash and game).
const fmt = new Intl.NumberFormat('en-US');

export const formatNumber = (n: number) => fmt.format(n);

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${fmt.format(n)} ${n === 1 ? word : many}`;

// "7h 12m", "45m", "3d". Rounds up so "in 1m" never reads as "now".
export function duration(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Short form for tight spots: "7h", "45m", "3d".
export function durationShort(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h >= 48 ? `${Math.floor(h / 24)}d` : `${h}h`;
}

// Percentages that add up to exactly 100 (largest-remainder method).
export function sharePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (100 * c) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors;
}

// "600+0" -> "10+0 · Rapid" (Lichess speed bands on estimated duration).
export function timeControlLabel(tc: string): string {
  const m = /^(\d+)\+(\d+)$/.exec(tc);
  if (!m) return tc === '-' ? 'Correspondence' : tc;
  const base = Number(m[1]);
  const inc = Number(m[2]);
  const est = base + 40 * inc;
  const speed =
    est < 30
      ? 'UltraBullet'
      : est < 180
        ? 'Bullet'
        : est < 480
          ? 'Blitz'
          : est < 1500
            ? 'Rapid'
            : 'Classical';
  const mins =
    base % 60 === 0
      ? String(base / 60)
      : (base / 60).toFixed(1).replace(/\.0$/, '');
  return `${mins}+${inc} ${speed}`;
}
