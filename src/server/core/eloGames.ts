import bundled from '../data/elo-games.json';

// Row = [movetext, timeControl, result, whiteElo, blackElo]
export type EloRow = {
  movetext: string;
  timeControl: string;
  result: string;
  white: number;
  black: number;
};

const data: unknown = bundled;

const toRow = (r: unknown): EloRow | null => {
  if (!Array.isArray(r)) return null;
  const [movetext, timeControl, result, white, black] = r;
  if (
    typeof movetext !== 'string' ||
    typeof timeControl !== 'string' ||
    typeof result !== 'string' ||
    typeof white !== 'number' ||
    typeof black !== 'number'
  )
    return null;
  return { movetext, timeControl, result, white, black };
};

export const bundledEloGames: unknown[] = (() => {
  const games: unknown =
    typeof data === 'object' && data ? Reflect.get(data, 'games') : null;
  return Array.isArray(games) ? games : [];
})();

/** Game at cursor `index`, wrapping once the set is used up. */
export const eloGameAt = (set: unknown[], index: number): EloRow | null =>
  set.length === 0 ? null : toRow(set[index % set.length]);
