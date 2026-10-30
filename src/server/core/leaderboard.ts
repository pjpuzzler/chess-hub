import { redis } from '@devvit/web/server';
import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardResponse,
} from '../../shared/api';
import { touchUser } from './privacy';
import { keys, toInt } from './store';

const TOP = 25;
// Users need this many Guess the Elo games to appear on the elo board.
export const MIN_ELO_GAMES = 3;

export const isBanned = async (username: string): Promise<boolean> =>
  (await redis.hGet(keys.banned, username)) !== undefined;

const latestDaily = async () => toInt(await redis.get(keys.latest('daily')));

/** Rank of `username` in a sorted set (1 = highest), or null. */
const rankIn = async (
  key: string,
  username: string
): Promise<{ rank: number; value: number } | null> => {
  const [asc, score, card] = await Promise.all([
    redis.zRank(key, username),
    redis.zScore(key, username),
    redis.zCard(key),
  ]);
  if (asc === undefined || score === undefined) return null;
  return { rank: card - asc, value: score };
};

const top = (key: string) =>
  redis.zRange(key, 0, TOP - 1, { by: 'rank', reverse: true });

/**
 * Current streaks: only users whose last streak solve was the latest or the
 * previous daily puzzle are alive, and each of those lives in its own
 * per-number set. Merging the top of both is exact for the top 25.
 */
const streakBoard = async (
  username: string | null
): Promise<{ entries: LeaderboardEntry[]; me: LeaderboardEntry | null }> => {
  const latest = await latestDaily();
  const [a, b] = await Promise.all([
    top(keys.streakBoard(latest)),
    top(keys.streakBoard(latest - 1)),
  ]);
  const best = new Map<string, number>();
  for (const { member, score } of [...a, ...b])
    best.set(member, Math.max(best.get(member) ?? 0, score));
  const entries = [...best.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, TOP)
    .map(([u, value], i) => ({ rank: i + 1, username: u, value }));
  let me = entries.find((e) => e.username === username) ?? null;
  if (!me && username) {
    // Outside the top: approximate rank across both sets.
    const [ra, rb] = await Promise.all([
      rankIn(keys.streakBoard(latest), username),
      rankIn(keys.streakBoard(latest - 1), username),
    ]);
    const mine = ra ?? rb;
    if (mine)
      me = {
        rank: (ra?.rank ?? 0) + (rb?.rank ?? 0),
        username,
        value: mine.value,
      };
  }
  return { entries, me };
};

export const getLeaderboard = async (
  kind: LeaderboardKind,
  username: string | null
): Promise<LeaderboardResponse> => {
  if (kind === 'streak')
    return { type: 'leaderboard', kind, ...(await streakBoard(username)) };
  const key = keys.leaderboard(kind);
  const raw = await top(key);
  const entries = raw.map(({ member, score }, i) => ({
    rank: i + 1,
    username: member,
    value: score,
  }));
  let me = entries.find((e) => e.username === username) ?? null;
  if (!me && username) {
    const r = await rankIn(key, username);
    if (r) me = { username, ...r };
  }
  return { type: 'leaderboard', kind, entries, me };
};

/** Mod action: drop a user from every board and keep them off. */
export const removeFromLeaderboards = async (
  username: string,
  by: string,
  now: number = Date.now()
): Promise<void> => {
  await touchUser(username, {}, now);
  await touchUser(by, {}, now);
  await redis.hSet(keys.banned, {
    [username]: JSON.stringify({ by, at: now }),
  });
  const latest = await latestDaily();
  await Promise.all([
    redis.zRem(keys.leaderboard('rating'), [username]),
    redis.zRem(keys.leaderboard('solved'), [username]),
    redis.zRem(keys.leaderboard('elo'), [username]),
    redis.zRem(keys.streakBoard(latest), [username]),
    redis.zRem(keys.streakBoard(latest - 1), [username]),
  ]);
};
