// Scheduled posts: the Daily Puzzle and the curated Guess the Elo game. Each
// series posts at most once per UTC date (atomic date claim), takes its data
// sequentially through a cursor, and numbers posts #1, #2, ...
import { context, reddit, redis } from '@devvit/web/server';
import { Chess } from 'chess.js';
import type { PostData } from '../../shared/api';
import { playUci, sideName } from '../../shared/chess/poll';
import { parseGame } from '../../shared/chess/review';
import { bundledEloGames, eloGameAt } from './eloGames';
import { highlightEloForADay, pinNewDaily } from './pin';
import { anarchyDay, bundledAnarchy, type AnarchySet } from './anarchy';
import { bundledPuzzles, rowToPuzzle, type PuzzleSet } from './puzzles';
import { bucketFor, getSettings, isAnarchy } from './settings';
import {
  FEED_STYLES,
  keys,
  parseJson,
  putPost,
  toInt,
  withTransaction,
  type PuzzleData,
  type Series,
  type StoredPost,
} from './store';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
// A claim older than this is assumed to belong to a crashed run.
const CLAIM_TTL_MS = 10 * 60 * 1000;
// How many malformed entries to skip before giving up.
const MAX_SKIP = 20;

/** YYYY-MM-DD in UTC. */
export const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

const shortDate = (date: string): string => {
  const [, m, d] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`;
};

export const dailyTitle = (
  n: number,
  side: 'white' | 'black',
  date: string,
  anarchy = false
): string =>
  `Daily ${anarchy ? 'Anarchy ' : ''}Puzzle #${n} · ${side === 'white' ? 'White' : 'Black'} to move · ${shortDate(date)}`;

/** Position the solver faces (after the setup move) and who they play. */
export const solverView = (
  puzzle: PuzzleData
): { fen: string; side: 'white' | 'black' } | null => {
  const setup = puzzle.moves[0];
  if (!setup) return null;
  const fen = playUci(puzzle.fen, setup);
  if (!fen) return null;
  return { fen, side: sideName(new Chess(fen).turn()) };
};

// A date's value: the post id, `pending:<ms>` while a run posts, or
// `deleted:<post id>` once a mod deleted that day's post. A deleted day stays
// claimed so the hourly retry doesn't repost it; the mod menu can still post.
export const DELETED = 'deleted:';

export const todaysPostId = async (
  date: string,
  series: Series = 'daily'
): Promise<string | null> => {
  const v = await redis.hGet(keys.dates(series), date);
  return v && !v.startsWith('pending:') && !v.startsWith(DELETED) ? v : null;
};

/** Claim `date` for this run. Stale claims from crashed runs can be taken over. */
export const claimDate = async (
  series: Series,
  date: string,
  now: Date
): Promise<boolean> => {
  const key = keys.dates(series);
  const mine = `pending:${now.getTime()}`;
  if ((await redis.hSetNX(key, date, mine)) === 1) return true;
  return withTransaction([key], async (txn) => {
    const cur = await redis.hGet(key, date);
    const startedAt = cur?.startsWith('pending:')
      ? toInt(cur.slice('pending:'.length))
      : null;
    if (startedAt === null || now.getTime() - startedAt < CLAIM_TTL_MS)
      return { value: false, write: false };
    await txn.hSet(key, { [date]: mine });
    return { value: true, write: true };
  });
};

export type DailyResult =
  | { status: 'posted'; postId: string; number: number }
  | { status: 'exists'; postId: string | null }
  | { status: 'error'; message: string };

type Prepared = {
  title: string;
  postData: PostData;
  fallback: string;
  flair: string;
  cursorKey: string;
  nextCursor: number;
  record: (number: number) => StoredPost;
};

/** Best-effort write, tried 3 times; resolves to whether it succeeded. */
export const retry = async (
  what: string,
  fn: () => Promise<unknown>
): Promise<boolean> => {
  for (let i = 0; i < 3; i++) {
    try {
      await fn();
      return true;
    } catch (e) {
      console.error(`${what} write failed (try ${i + 1}): ${e}`);
    }
  }
  return false;
};

/** Flair template id whose text matches (case-insensitive), if any. */
const flairId = async (text: string): Promise<string | undefined> => {
  try {
    const all = await reddit.getPostFlairTemplates(context.subredditName);
    return all.find((f) => f.text.trim().toLowerCase() === text.toLowerCase())
      ?.id;
  } catch {
    return undefined;
  }
};

const postSeries = async (
  series: Series,
  now: Date,
  prepare: (date: string, number: number) => Promise<Prepared>
): Promise<DailyResult> => {
  const date = utcDate(now);
  if (!(await claimDate(series, date, now)))
    return { status: 'exists', postId: await todaysPostId(date, series) };

  let postId: string;
  let number: number;
  let prep: Prepared;
  try {
    number = toInt(await redis.get(keys.latest(series))) + 1;
    prep = await prepare(date, number);
    const flair = await flairId(prep.flair);
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: prep.title,
      postData: prep.postData,
      textFallback: { text: prep.fallback },
      styles: FEED_STYLES,
      ...(flair ? { flairId: flair } : {}),
    });
    postId = post.id;
  } catch (e) {
    // Nothing was posted (or we cannot know otherwise), so free the date.
    await redis.hDel(keys.dates(series), [date]).catch(() => undefined);
    console.error(`${series} post failed: ${e}`);
    return { status: 'error', message: 'Something went wrong. Try again.' };
  }

  // The post exists. From here on the claim is never released: record the
  // date first, then the details, each retried and best-effort so a Redis
  // hiccup cannot lead to a second post.
  await retry('date mapping', () =>
    redis.hSet(keys.dates(series), { [date]: postId })
  );
  await retry('post record', () => putPost(postId, prep.record(number)));
  await retry('latest post', () =>
    redis.set(keys.latestPost(series), JSON.stringify({ postId, number }))
  );
  await retry('counters', () =>
    redis.mSet({
      [keys.latest(series)]: String(number),
      [prep.cursorKey]: String(prep.nextCursor),
    })
  );
  return { status: 'posted', postId, number };
};

/** Post the daily puzzle for `now`'s UTC date (at most once per date). */
export const postDailyPuzzle = async (
  now: Date = new Date(),
  set: PuzzleSet = bundledPuzzles,
  anarchySet: AnarchySet = bundledAnarchy
): Promise<DailyResult> => {
  const anarchyStyle = await isAnarchy();
  const res = await postSeries('daily', now, async (date, number) => {
    // Anarchy style draws from the day's themed bucket (own cursor); classic,
    // or an empty themed bucket, uses the weekday difficulty bucket.
    const day = anarchyDay(date);
    const themed = anarchyStyle ? (anarchySet[day.bucket] ?? []) : [];
    const anarchy = themed.length > 0;
    const bucket = anarchy ? day.bucket : bucketFor(date);
    const rows = anarchy ? themed : set[bucketFor(date)];
    const cursorKey = keys.cursor(
      'daily',
      anarchy ? `anarchy:${bucket}` : bucket
    );
    const cursor = toInt(await redis.get(cursorKey));
    for (let skip = 0; skip < MAX_SKIP; skip++) {
      const raw = rows.length ? rows[(cursor + skip) % rows.length] : undefined;
      const puzzle = raw ? rowToPuzzle(raw) : null;
      const view = puzzle && solverView(puzzle);
      if (!puzzle || !view) continue;
      const side = view.side === 'white' ? 'White' : 'Black';
      return {
        title: dailyTitle(number, view.side, date, anarchy),
        postData: {
          kind: 'puzzle',
          fen: view.fen,
          orientation: view.side,
          card: {
            kind: 'puzzle',
            number,
            rating: puzzle.rating,
            tagline: anarchy ? day.tagline : null,
            anarchy: anarchyStyle,
          },
        },
        fallback: `Daily ${anarchy ? 'Anarchy ' : ''}Puzzle #${number}: ${side} to play. FEN: ${view.fen}`,
        flair: 'Daily Puzzle',
        cursorKey,
        nextCursor: cursor + skip + 1,
        record: (n) => ({
          kind: 'puzzle',
          number: n,
          date,
          puzzle,
          tagline: anarchy ? day.tagline : null,
        }),
      };
    }
    throw new Error(`No usable puzzle in '${bucket}'.`);
  });
  if (res.status === 'posted') {
    const { pin } = await getSettings();
    await pinNewDaily(res.postId, pin);
  }
  return res;
};

/** Post the curated Guess the Elo game for `now`'s UTC date. */
export const postEloGame = async (
  now: Date = new Date(),
  set: unknown[] = bundledEloGames
): Promise<DailyResult> => {
  const res = await postSeries('elo', now, async (date, number) => {
    const cursorKey = keys.cursor('elo', 'all');
    const cursor = toInt(await redis.get(cursorKey));
    for (let skip = 0; skip < MAX_SKIP; skip++) {
      const row = eloGameAt(set, cursor + skip);
      const game = row && parseGame(row.movetext);
      if (!row || !game || 'error' in game) continue;
      return {
        title: `Guess the Elo #${number}`,
        postData: {
          kind: 'elo',
          fen: game.fens[game.fens.length - 1] ?? game.startFen,
          orientation: 'white',
          card: { kind: 'elo', number, timeControl: row.timeControl },
        },
        fallback:
          `Guess the Elo #${number}: guess the players' average rating. ${movetextOnly(game.pgn)}`.slice(
            0,
            2000
          ),
        flair: 'Guess the Elo',
        cursorKey,
        nextCursor: cursor + skip + 1,
        record: (n) => ({
          kind: 'elo',
          number: n,
          date,
          game: {
            pgn: movetextOnly(game.pgn),
            timeControl: row.timeControl,
            result: row.result,
          },
          white: row.white,
          black: row.black,
          source: 'curated',
          author: null,
          caption: '',
        }),
      };
    }
    throw new Error('No usable Guess the Elo game.');
  });
  if (res.status === 'posted') {
    const { pin } = await getSettings();
    await highlightEloForADay(res.postId, pin, now);
  }
  return res;
};

/** Drop PGN header lines, keeping only the moves and result. */
export const movetextOnly = (pgn: string): string =>
  pgn
    .split('\n')
    .filter((l) => !l.startsWith('['))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * When the next daily puzzle is due (epoch ms), or null if they are off. The
 * hourly task posts on the hour once the configured hour has come.
 */
export const nextPuzzleAt = async (
  now: Date = new Date()
): Promise<number | null> => {
  // Today's post is read alongside the settings (unused if puzzles are off).
  const [s, todays] = await Promise.all([
    getSettings(),
    redis.hGet(keys.dates('daily'), utcDate(now)),
  ]);
  if (!s.dailyPuzzle) return null;
  const todayAt = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    s.postHourUtc
  );
  // Posted (or deleted by a mod): tomorrow.
  if (todays && !todays.startsWith('pending:')) return todayAt + 86_400_000;
  if (now.getTime() < todayAt) return todayAt;
  // Due but not posted yet: the next hourly run.
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  return nextHour.getTime() + 3_600_000;
};

/** The newest curated Guess the Elo post, or null if none or they are off. */
export const currentElo = async (): Promise<{
  postId: string;
  number: number;
} | null> => {
  const [{ elo }, raw] = await Promise.all([
    getSettings(),
    redis.get(keys.latestPost('elo')),
  ]);
  if (elo === 'off') return null;
  const v = parseJson(raw);
  if (typeof v !== 'object' || v === null) return null;
  const postId: unknown = Reflect.get(v, 'postId');
  const number: unknown = Reflect.get(v, 'number');
  return typeof postId === 'string' && typeof number === 'number'
    ? { postId, number }
    : null;
};
