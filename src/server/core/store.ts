// Redis key schema and per-post records. All keys are per-subreddit install.
import { redis } from '@devvit/web/server';
import type { EloGame } from '../../shared/api';

// Full puzzle as stored server-side (the solution never leaves the server
// until the viewer finishes).
export type PuzzleData = {
  id: string;
  fen: string; // before the setup move
  moves: string[]; // setup move first, then solver/opponent alternating
  rating: number;
  themes: string[];
};

export const keys = {
  // JSON StoredPost.
  post: (postId: string) => `post:${postId}`,

  // ---- scheduled posts (series = 'daily' puzzle or 'elo') ----
  // Latest number in the series (string int).
  latest: (series: Series) => `${series}:latest`,
  // Next unused index into a bucket of the bundled data.
  cursor: (series: Series, bucket: string) => `${series}:cursor:${bucket}`,
  // Hash: YYYY-MM-DD -> postId, or 'pending:<epochMs>' while claimed (hSetNX).
  dates: (series: Series) => `${series}:dates`,
  // JSON {postId, number} of the newest post in the series.
  latestPost: (series: Series) => `${series}:latestPost`,
  // postId of the daily puzzle we last pinned (only the puzzle is pinned).
  pinned: (series: Series) => `${series}:pinned`,

  // ---- puzzles ----
  // Hash: attempts, clean.
  stats: (postId: string) => `puz:${postId}:stats`,
  // Hash per post: a:<user> rating event ('win'|'loss'), r:<user> result
  // ('solved'|'failed'), v:<user> '1' once revealed, s:<user> '1' once the
  // solve was counted. Gates are taken with hSetNX. Also t0/tm/tf:<user>
  // solve timing (see markTiming), never sent to clients.
  attempts: (postId: string) => `puz:${postId}:attempts`,
  // Move/hint calls per user per post (hourly window).
  puzzleCalls: (postId: string, username: string) =>
    `puz:${postId}:calls:${username}`,

  // Hash per user, fixed fields only: rating, rated, solved, streak, best,
  // last, eloTotal, eloGames. Read with hGet per field.
  user: (username: string) => `user:${username}`,
  // Hash: daily number -> run length ending there (only solved numbers).
  streakRuns: (username: string) => `streak:${username}`,

  // ---- polls ----
  // Hash: username -> uci (one final vote each).
  votes: (postId: string) => `poll:${postId}:votes`,
  // Hash: uci -> count.
  counts: (postId: string) => `poll:${postId}:counts`,

  // ---- reviews ----
  // Hash: field 'analysis' -> JSON ReviewAnalysis (hSetNX: first valid wins).
  review: (postId: string) => `review:${postId}`,
  // Analysis submissions per post (hourly window).
  reviewSubs: (postId: string) => `review:${postId}:subs`,
  // Analysis submissions per user per post (hourly window).
  reviewUserSubs: (postId: string, username: string) =>
    `review:${postId}:subs:${username}`,
  // Member posts (reviews, Guess my Elo, polls) a user made on a UTC day.
  memberDaily: (username: string, date: string) =>
    `rl:member:${username}:${date}`,
  // Hash: 'held' -> epoch ms; one Lichess request at a time.
  lichessLock: 'lichess:lock',
  // Game fetches per user (hourly window).
  gameFetches: (username: string) => `rl:fetch:${username}`,
  // Epoch ms until which Lichess asked us to back off (after a 429).
  lichessCooldown: 'lichess:cooldown',

  // ---- guess the elo ----
  // Hash: username -> guess.
  eloGuesses: (postId: string) => `elo:${postId}:guesses`,
  // Hash: 100-pt bucket -> count.
  eloHist: (postId: string) => `elo:${postId}:hist`,
  // Hash: absolute error -> count (for percentiles).
  eloErrors: (postId: string) => `elo:${postId}:errors`,

  // ---- community game ----
  // JSON GameState (versioned): the subreddit's current game.
  gameState: 'cg:state',
  // Games started so far (string int).
  gameCount: 'cg:count',
  // Vote order counter per game post (votes store "<uci>@<seq>").
  gameSeq: (postId: string) => `cg:${postId}:seq`,
  // Hash: 'held' -> epoch ms while a Start is in progress.
  gameStartLock: 'cg:startLock',

  // ---- privacy ----
  // Sorted set: every username we store data for, score = last activity.
  knownUsers: 'users:known',
  // Sorted sets per user: posts they voted/attempted/guessed on, and posts
  // they authored (for purging on account deletion).
  userPosts: (username: string) => `userposts:${username}`,
  userAuthored: (username: string) => `userauthored:${username}`,
  // Rank position of the next account check.
  sweepCursor: 'users:sweepCursor',
  // Hash: one-time data migrations already run.
  migrations: 'app:migrations',

  // ---- leaderboards ----
  // Sorted sets: rating, solved, elo (total score).
  leaderboard: (kind: 'rating' | 'solved' | 'elo') => `lb:${kind}`,
  // Sorted set of current streaks of users whose last streak solve was daily
  // puzzle #n. The board reads #latest and #latest-1; old sets expire.
  streakBoard: (n: number) => `lb:streak:${n}`,
  // Hash: username -> JSON {by, at}. Removed by a moderator; never re-added.
  banned: 'lb:banned',
} as const;

export type Series = 'daily' | 'elo' | 'game';

export type StoredPuzzlePost = {
  kind: 'puzzle';
  number: number;
  date: string;
  puzzle: PuzzleData;
  // Anarchy style only: the day's framing line.
  tagline?: string | null;
};
export type StoredPollPost = {
  kind: 'poll';
  fen: string;
  prompt: string;
  lastMove: string | null;
  closesAt: number | null;
};
export type StoredReviewPost = {
  kind: 'review';
  pgn: string;
  white: string;
  black: string;
  result: string;
  caption: string;
  author: string | null;
};
export type StoredEloPost = {
  kind: 'elo';
  number: number;
  date: string;
  game: EloGame;
  white: number;
  black: number;
  source: 'curated' | 'lichess' | 'selfReported';
  author: string | null;
  caption: string;
};
export type StoredGamePost = {
  kind: 'game';
  gameNumber: number;
  fen: string; // position voted on
  moves: string[]; // UCI moves before this vote
  // 'closing' (internal): the daily tally is running; votes are refused and
  // clients see 'open'.
  status: 'open' | 'closing' | 'closed' | 'ended';
  winningMove: string | null;
  nextPostId: string | null;
  // Vote counts the winner was picked from (set when closed).
  finalCounts?: Record<string, number>;
};
export type StoredPost =
  | StoredPuzzlePost
  | StoredPollPost
  | StoredReviewPost
  | StoredEloPost
  | StoredGamePost;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export const parseJson = (raw: string | undefined | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** The stored post, or null for unknown and retired kinds (e.g. 'analysis'). */
export const getPost = async (postId: string): Promise<StoredPost | null> => {
  const data = parseJson(await redis.get(keys.post(postId)));
  if (!isRecord(data)) return null;
  // Written only by this app, so trust the shape once the discriminant matches.
  if (data['kind'] === 'puzzle') return data as StoredPuzzlePost;
  if (data['kind'] === 'poll') return data as StoredPollPost;
  if (data['kind'] === 'review') return data as StoredReviewPost;
  if (data['kind'] === 'elo') return data as StoredEloPost;
  if (data['kind'] === 'game') return data as StoredGamePost;
  return null;
};

export const putPost = async (postId: string, post: StoredPost) => {
  await redis.set(keys.post(postId), JSON.stringify(post));
};

export const toInt = (v: string | undefined | null, fallback = 0): number => {
  const n = v == null ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Increment a windowed counter; returns the new count. */
export const bump = async (key: string, ttlSeconds: number) => {
  const n = await redis.incrBy(key, 1);
  if (n === 1) await redis.expire(key, ttlSeconds);
  return n;
};

// eslint-disable-next-line no-control-regex
const CONTROL_NO_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** Plain text, no control characters (newlines kept), capped length. */
export const cleanText = (v: string, max: number): string =>
  v.replace(CONTROL_NO_NEWLINE, '').trim().slice(0, max);

/** At most `max` characters (whole code points) for postData's 2 KB. */
export const clip = (v: string, max: number): string =>
  Array.from(v).slice(0, max).join('');

/**
 * Run `fn` inside an optimistic Redis transaction on `watchKeys`, retrying if
 * another request touched them first. `fn` reads with the plain client, then
 * queues writes on `txn`. Returns fn's result.
 */
export const withTransaction = async <T>(
  watchKeys: string[],
  fn: (
    txn: Awaited<ReturnType<typeof redis.watch>>
  ) => Promise<{ value: T; write: boolean }>
): Promise<T> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const txn = await redis.watch(...watchKeys);
    let result: { value: T; write: boolean };
    try {
      await txn.multi();
      result = await fn(txn);
    } catch (e) {
      await txn.discard().catch(() => undefined);
      throw e;
    }
    if (!result.write) {
      await txn.discard();
      return result.value;
    }
    const out = await txn.exec();
    // A conflicted exec reports no results (null, or possibly empty).
    if (Array.isArray(out) && out.length > 0) return result.value;
  }
  throw new Error('Too many concurrent updates');
};

/**
 * Feed card styles, set on every post we submit. Reddit stores a post's height when
 * it is created, so devvit.json alone does not resize posts (the splash is laid out
 * for 264 px).
 */
export const FEED_STYLES = { heightPixels: 264 };
// The community game is the sub's shared event: a tall card with the board
// full width on phones (393-430 px wide).
export const GAME_FEED_STYLES = { heightPixels: 512 };
