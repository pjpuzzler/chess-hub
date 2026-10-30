// Anarchy style: the daily puzzle rotates themes that match r/AnarchyChess
// memes (real Lichess puzzles, normal rules), one framing line each.
import bundled from '../data/anarchy-puzzles.json';

export type AnarchyBucket =
  | 'enPassant'
  | 'knightBoost'
  | 'doubleCheck'
  | 'castling'
  | 'smothered'
  | 'easyMate'
  | 'hard';

// Index = UTC weekday (0 = Sunday).
const WEEK: { bucket: AnarchyBucket; tagline: string }[] = [
  { bucket: 'hard', tagline: 'Boring chess. For the nerds' },
  { bucket: 'enPassant', tagline: 'Brick rule in effect' },
  { bucket: 'knightBoost', tagline: 'Knight boost' },
  { bucket: 'doubleCheck', tagline: 'Double check wins the game' },
  { bucket: 'castling', tagline: 'Special move: castling' },
  { bucket: 'smothered', tagline: 'The horsey has had enough' },
  { bucket: 'easyMate', tagline: 'Gavin from 3rd grade solved this one' },
];

/** Theme and tagline for a UTC date (YYYY-MM-DD). */
export const anarchyDay = (date: string) => {
  const day = WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];
  // getUTCDay is 0-6, so this always exists.
  return (
    day ?? { bucket: 'hard' as const, tagline: 'Boring chess. For the nerds' }
  );
};

export type AnarchySet = Partial<Record<AnarchyBucket, unknown[][]>>;

const data: unknown = bundled;

export const bundledAnarchy: AnarchySet = (() => {
  const buckets: unknown =
    typeof data === 'object' && data ? Reflect.get(data, 'buckets') : null;
  if (typeof buckets !== 'object' || !buckets) return {};
  const out: AnarchySet = {};
  for (const { bucket } of WEEK) {
    const rows: unknown = Reflect.get(buckets, bucket);
    if (Array.isArray(rows) && rows.every((r) => Array.isArray(r)))
      out[bucket] = rows;
  }
  return out;
})();
