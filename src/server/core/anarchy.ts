// Anarchy style: the daily puzzle rotates themes that match r/AnarchyChess
// memes (real Lichess puzzles, normal rules), one framing line each.
import bundled from '../data/anarchy-puzzles.json';

export type AnarchyBucket =
  'enPassant' | 'knightBoost' | 'doubleCheck' | 'smothered' | 'rookSac';

// Index = UTC weekday (0 = Sunday). En passant, the sub's main meme, gets
// three days; the bucket holds puzzles with it anywhere in the line.
const WEEK: { bucket: AnarchyBucket; tagline: string }[] = [
  { bucket: 'enPassant', tagline: 'En passant is forced' },
  { bucket: 'enPassant', tagline: 'Google en passant' },
  { bucket: 'knightBoost', tagline: 'Knight boost' },
  { bucket: 'doubleCheck', tagline: 'Double check wins the game' },
  { bucket: 'enPassant', tagline: 'Holy hell' },
  { bucket: 'smothered', tagline: 'The horsey has had enough' },
  { bucket: 'rookSac', tagline: 'Sacrifice the rook' },
];

const SUNDAY = {
  bucket: 'enPassant' as const,
  tagline: 'En passant is forced',
};

/** Theme and tagline for a UTC date (YYYY-MM-DD). */
export const anarchyDay = (date: string) =>
  // getUTCDay is 0-6, so this always exists.
  WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? SUNDAY;

export type AnarchySet = Partial<Record<AnarchyBucket, unknown[][]>>;

const data: unknown = bundled;

export const bundledAnarchy: AnarchySet = (() => {
  const buckets: unknown =
    typeof data === 'object' && data ? Reflect.get(data, 'buckets') : null;
  if (typeof buckets !== 'object' || !buckets) return {};
  const out: AnarchySet = {};
  for (const bucket of new Set(WEEK.map((d) => d.bucket))) {
    const rows: unknown = Reflect.get(buckets, bucket);
    if (Array.isArray(rows) && rows.every((r) => Array.isArray(r)))
      out[bucket] = rows;
  }
  return out;
})();
