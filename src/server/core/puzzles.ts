import type { PuzzleData } from './store';
import type { Bucket } from './settings';
import bundled from '../data/puzzles.json';

// Row = [id, fen, moves (space separated), rating, themes (space separated)]
export type PuzzleSet = Record<Bucket, unknown[][]>;

const data: unknown = bundled;

const isRows = (v: unknown): v is unknown[][] =>
  Array.isArray(v) && v.every((r) => Array.isArray(r));

export const bundledPuzzles: PuzzleSet = (() => {
  const d = (typeof data === 'object' && data) || {};
  const pick = (k: Bucket): unknown[][] => {
    const v: unknown = Reflect.get(d, k);
    return isRows(v) ? v : [];
  };
  return { easy: pick('easy'), medium: pick('medium'), hard: pick('hard') };
})();

export const rowToPuzzle = (row: unknown[]): PuzzleData | null => {
  const [id, fen, moves, rating, themes] = row;
  if (
    typeof id !== 'string' ||
    typeof fen !== 'string' ||
    typeof moves !== 'string' ||
    typeof rating !== 'number'
  )
    return null;
  const list = moves.split(' ').filter(Boolean);
  // Setup move plus whole solver/opponent pairs ending on a solver move.
  if (list.length < 2 || list.length % 2 !== 0) return null;
  return {
    id,
    fen,
    moves: list,
    rating,
    themes: typeof themes === 'string' ? themes.split(' ').filter(Boolean) : [],
  };
};

/** The puzzle at cursor position `index`, wrapping once the bucket is used up. */
export const puzzleAt = (
  set: PuzzleSet,
  bucket: Bucket,
  index: number
): PuzzleData | null => {
  const rows = set[bucket];
  if (rows.length === 0) return null;
  const row = rows[index % rows.length];
  return row ? rowToPuzzle(row) : null;
};
