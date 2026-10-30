// Puzzle accounting. The server decides every result; clients only send moves.
import { redis } from '@devvit/web/server';
import type { Puzzle, PuzzleMe, PuzzleStats } from '../../shared/api';
import {
  MIN_RATED_ATTEMPTS,
  START_RATING,
  updateRating,
} from '../../shared/chess/rating';
import {
  applySolve,
  displayStreak,
  type StreakState,
} from '../../shared/chess/streak';
import { isBanned } from './leaderboard';
import { touchUser } from './privacy';
import { solverMoveCount } from './puzzleCheck';
import {
  keys,
  toInt,
  withTransaction,
  type PuzzleData,
  type StoredPuzzlePost,
} from './store';

// Lapsed streak boards are dropped after this long.
const STREAK_BOARD_TTL = 4 * 86400;

type Profile = {
  rating: number;
  rated: number;
  solvedTotal: number;
  streak: StreakState;
};

const PROFILE_FIELDS = ['rating', 'rated', 'solved', 'streak', 'best', 'last'];

/** Fixed fields only (hGet each; the hash never grows). */
const readProfile = async (username: string): Promise<Profile> => {
  const [rating, rated, solved, streak, best, last] = await Promise.all(
    PROFILE_FIELDS.map((f) => redis.hGet(keys.user(username), f))
  );
  return {
    rating: toInt(rating, START_RATING),
    rated: toInt(rated),
    solvedTotal: toInt(solved),
    streak: { streak: toInt(streak), best: toInt(best), last: toInt(last) },
  };
};

type Marks = {
  rated: 'win' | 'loss' | null;
  result: 'solved' | 'failed' | null;
  revealed: boolean;
};

const readMarks = async (postId: string, username: string): Promise<Marks> => {
  const k = keys.attempts(postId);
  const [a, r, v] = await Promise.all([
    redis.hGet(k, `a:${username}`),
    redis.hGet(k, `r:${username}`),
    redis.hGet(k, `v:${username}`),
  ]);
  return {
    rated: a === 'win' || a === 'loss' ? a : null,
    result: r === 'solved' || r === 'failed' ? r : null,
    revealed: v === '1',
  };
};

export const getLatestNumber = async (): Promise<number> =>
  toInt(await redis.get(keys.latest('daily')));

export const getStats = async (postId: string): Promise<PuzzleStats> => {
  const [attempts, clean] = await Promise.all([
    redis.hGet(keys.stats(postId), 'attempts'),
    redis.hGet(keys.stats(postId), 'clean'),
  ]);
  return { attempts: toInt(attempts), cleanSolves: toInt(clean) };
};

const toMe = (p: Profile, m: Marks, latest: number): PuzzleMe => ({
  status: m.result ?? 'unsolved',
  cleanSolve: m.rated === 'win',
  streak: displayStreak(p.streak, latest),
  bestStreak: p.streak.best,
  rating: p.rating,
  solvedTotal: p.solvedTotal,
});

export const getMe = async (
  username: string,
  postId: string
): Promise<PuzzleMe> => {
  const [p, m, latest] = await Promise.all([
    readProfile(username),
    readMarks(postId, username),
    getLatestNumber(),
  ]);
  return toMe(p, m, latest);
};

/** Has this viewer finished (solved or gave up), so may see the solution? */
export const hasFinished = async (
  username: string | null,
  postId: string
): Promise<boolean> => {
  if (!username) return false;
  const m = await readMarks(postId, username);
  return m.result === 'solved' || m.revealed;
};

/** The puzzle as sent to a client: no solution until finished. */
export const publicPuzzle = (p: PuzzleData, finished: boolean): Puzzle => ({
  id: p.id,
  fen: p.fen,
  setupMove: p.moves[0] ?? '',
  solverMoves: solverMoveCount(p),
  rating: p.rating,
  solution: finished ? p.moves : null,
  themes: finished ? p.themes : null,
});

export type PuzzleEvent = 'hint' | 'wrong' | 'solved' | 'reveal';

export type Recorded = {
  me: PuzzleMe;
  stats: PuzzleStats;
  ratingDelta: number;
};

/**
 * Record what happened on a user's attempt. Two atomic hSetNX gates make
 * duplicate or concurrent requests safe without trusting the client:
 * - the rating gate (a:<user>) is taken by the first event of any kind; only a
 *   solve without a prior hint/miss/reveal is a win (clean solve);
 * - the result gate (r:<user>) is taken by the first miss, reveal or solve and
 *   sets solved/failed; a later solve upgrades failed to solved (not after a
 *   reveal);
 * - the counted-solve gate (s:<user>) makes the solved total and the streak
 *   move once per puzzle for any solve, even after a miss or hint, but not
 *   after giving up. Streaks only take today's or yesterday's puzzle.
 */
export const recordEvent = async (
  username: string,
  postId: string,
  post: StoredPuzzlePost,
  event: PuzzleEvent
): Promise<Recorded> => {
  await touchUser(username, { postId });
  const att = keys.attempts(postId);
  const ratedFirst =
    (await redis.hSetNX(
      att,
      `a:${username}`,
      event === 'solved' ? 'win' : 'loss'
    )) === 1;
  let resultFirst = false;
  if (event !== 'hint') {
    if (event === 'reveal') await redis.hSetNX(att, `v:${username}`, '1');
    resultFirst =
      (await redis.hSetNX(
        att,
        `r:${username}`,
        event === 'solved' ? 'solved' : 'failed'
      )) === 1;
  }
  const marks = await readMarks(postId, username);
  const upgrade =
    !resultFirst &&
    event === 'solved' &&
    marks.result === 'failed' &&
    !marks.revealed;
  if (upgrade) await redis.hSet(att, { [`r:${username}`]: 'solved' });
  // Counted-solve gate: the solved total and streak move once per puzzle,
  // for any solve (even after a miss or hint), but never after giving up.
  const countSolve =
    event === 'solved' &&
    !marks.revealed &&
    (resultFirst || upgrade || marks.result === 'solved') &&
    (await redis.hSetNX(att, `s:${username}`, '1')) === 1;
  const banned = await isBanned(username);
  const userKey = keys.user(username);

  let out: { p: Profile; latest: number; delta: number };
  try {
    out = await withTransaction([userKey], async (txn) => {
      const p = await readProfile(username);
      const latest = await getLatestNumber();
      const fields: Record<string, string> = {};
      let delta = 0;

      if (ratedFirst) {
        const win = event === 'solved';
        const upd = updateRating(p.rating, post.puzzle.rating, win ? 1 : 0);
        delta = upd.delta;
        p.rating = upd.rating;
        p.rated += 1;
        fields['rating'] = String(p.rating);
        fields['rated'] = String(p.rated);
        await txn.hIncrBy(keys.stats(postId), 'attempts', 1);
        if (win) await txn.hIncrBy(keys.stats(postId), 'clean', 1);
        if (!banned && p.rated >= MIN_RATED_ATTEMPTS)
          await txn.zAdd(keys.leaderboard('rating'), {
            member: username,
            score: p.rating,
          });
      }
      if (countSolve) {
        p.solvedTotal += 1;
        fields['solved'] = String(p.solvedTotal);
        if (!banned)
          await txn.zAdd(keys.leaderboard('solved'), {
            member: username,
            score: p.solvedTotal,
          });
      }
      // Only today's or yesterday's puzzle counts; backlog solves never do.
      const n = post.number;
      if (countSolve && n >= latest - 1) {
        const runsKey = keys.streakRuns(username);
        const [prev, next] = await Promise.all([
          redis.hGet(runsKey, String(n - 1)),
          redis.hGet(runsKey, String(n + 1)),
        ]);
        const upd = applySolve(
          p.streak,
          n,
          toInt(prev),
          next === undefined ? null : toInt(next)
        );
        await txn.hSet(runsKey, {
          [String(n)]: String(upd.run),
          ...(upd.nextRun === null
            ? {}
            : { [String(n + 1)]: String(upd.nextRun) }),
        });
        p.streak = upd.state;
        fields['streak'] = String(upd.state.streak);
        fields['best'] = String(upd.state.best);
        fields['last'] = String(upd.state.last);
        if (!banned) {
          const board = keys.streakBoard(upd.state.last);
          await txn.zAdd(board, { member: username, score: upd.state.streak });
          await txn.expire(board, STREAK_BOARD_TTL);
        }
      }
      const changed = Object.keys(fields).length > 0;
      if (changed) await txn.hSet(userKey, fields);
      return { value: { p, latest, delta }, write: changed };
    });
  } catch (e) {
    // Give the gates back so the user's retry is accounted properly.
    const undo = [
      ...(ratedFirst ? [`a:${username}`] : []),
      ...(resultFirst ? [`r:${username}`] : []),
      ...(countSolve ? [`s:${username}`] : []),
    ];
    if (undo.length) await redis.hDel(att, undo).catch(() => undefined);
    throw e;
  }

  // Again now the per-user keys exist, so their inactivity TTL is set.
  await touchUser(username, { postId });
  return {
    me: toMe(out.p, await readMarks(postId, username), out.latest),
    stats: await getStats(postId),
    ratingDelta: out.delta,
  };
};

/**
 * Solve timing for later cheat analysis (never shown or returned). Per user
 * per post, in the attempts hash: t0 = epoch ms of their first view, tm = ms
 * from then to their first move, tf = ms to finishing. Each is set once.
 */
export const markViewed = async (
  postId: string,
  username: string,
  now = Date.now()
) => {
  await touchUser(username, { postId });
  await redis.hSetNX(keys.attempts(postId), `t0:${username}`, String(now));
};

export const markTiming = async (
  postId: string,
  username: string,
  done: boolean,
  now = Date.now()
) => {
  const k = keys.attempts(postId);
  // Viewed without an init (e.g. a direct API call): start the clock now.
  await redis.hSetNX(k, `t0:${username}`, String(now));
  const since = String(
    Math.max(0, now - toInt(await redis.hGet(k, `t0:${username}`), now))
  );
  await redis.hSetNX(k, `tm:${username}`, since);
  if (done) await redis.hSetNX(k, `tf:${username}`, since);
};
