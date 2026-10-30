import { context, reddit, settings } from '@devvit/web/server';

export type Bucket = 'easy' | 'medium' | 'hard';
export type PinMode = 'highlight' | 'sticky' | 'off';
export type EloMode = 'weekly' | 'daily' | 'off';

export type AppSettings = {
  dailyPuzzle: boolean;
  postHourUtc: number;
  pin: PinMode;
  elo: EloMode;
  highlightGame: boolean;
};

// Select settings may arrive as a string or a one-element array.
export const firstString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) ? firstString(v[0]) : undefined;

export const getSettings = async (): Promise<AppSettings> => {
  const [daily, hour, pin, elo, highlightGame] = await Promise.all([
    settings.get('dailyPuzzle'),
    settings.get('postHourUtc'),
    settings.get('pinDailyPuzzle'),
    settings.get('guessTheElo'),
    settings.get('highlightGame'),
  ]);
  const h = typeof hour === 'number' ? Math.trunc(hour) : 13;
  const p = firstString(pin);
  const e = firstString(elo);
  return {
    dailyPuzzle: daily !== false,
    postHourUtc: h >= 0 && h <= 23 ? h : 13,
    pin: p === 'sticky' || p === 'off' ? p : 'highlight',
    elo: e === 'daily' || e === 'off' ? e : 'weekly',
    highlightGame: highlightGame !== false,
  };
};

/** Meme style (Anarchy puzzles, taglines) only ever in r/AnarchyChess. */
export const isAnarchy = async (): Promise<boolean> =>
  context.subredditName?.toLowerCase() === 'anarchychess';

/** Mon/Tue easy, Wed-Fri medium, Sat/Sun hard; `date` is YYYY-MM-DD (UTC). */
export const bucketFor = (date: string): Bucket => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  if (day === 1 || day === 2) return 'easy';
  if (day >= 3 && day <= 5) return 'medium';
  return 'hard';
};

/** Is a Guess the Elo game due on this UTC date? (weekly = Saturdays) */
export const eloDue = (mode: EloMode, date: string): boolean =>
  mode === 'daily' ||
  (mode === 'weekly' && new Date(`${date}T00:00:00Z`).getUTCDay() === 6);

/** Members may post reviews, Guess my Elo games and polls. */
export const memberPostsAllowed = async (): Promise<boolean> =>
  (await settings.get('memberPosts')) !== false;

export const isModerator = async (username: string): Promise<boolean> => {
  try {
    const mods = await reddit
      .getModerators({ subredditName: context.subredditName, username })
      .all();
    return mods.length > 0;
  } catch (e) {
    console.error(`moderator check failed: ${e}`);
    return false;
  }
};
