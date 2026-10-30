// Account deletion and retention (Devvit rules: a deleted account's name must
// be removed everywhere, and author info nulled on content it created).
//
// - Every user we store anything for is tracked in `users:known` (score =
//   last activity) with the posts they touched and the posts they authored.
// - The hourly task checks a small rotating batch; an account Reddit no longer
//   returns, or one inactive past the retention window, is purged.
// - Per-user keys carry an inactivity TTL refreshed on each activity.
import { reddit, redis } from '@devvit/web/server';
import { getPost, keys, parseJson, putPost, toInt } from './store';

export const RETENTION_DAYS = 400;
const RETENTION_S = RETENTION_DAYS * 86400;
// Accounts checked per hourly run: enough to cover everyone within 30 days
// (ceil(tracked / 720)), at least 25. Capped at 400 so a run fits the 30 s
// request budget: lookups go in parallel chunks of 10, ~40 chunks at a few
// hundred ms each, and 400/hour stays far below Reddit's API rate limits.
// The cap covers 288k tracked users per 30 days; beyond that cycles stretch.
export const SWEEP_BATCH = 25;
export const SWEEP_CAP = 400;
const SWEEP_CHUNK = 10;
const CYCLE_HOURS = 30 * 24;

export const sweepBatchSize = (tracked: number): number =>
  Math.min(SWEEP_CAP, Math.max(SWEEP_BATCH, Math.ceil(tracked / CYCLE_HOURS)));
// Per-user vote mappings on posts that have closed are kept this long.
export const CLOSED_POST_VOTES_DAYS = 30;

const PURGE_FIELDS = (u: string) => [
  `a:${u}`,
  `r:${u}`,
  `v:${u}`,
  `s:${u}`,
  `t0:${u}`,
  `tm:${u}`,
  `tf:${u}`,
];

/** Record activity: refreshes the inactivity TTL on everything per-user. */
export const touchUser = async (
  username: string,
  opts: { postId?: string; authored?: boolean } = {},
  now: number = Date.now()
) => {
  await redis.zAdd(keys.knownUsers, { member: username, score: now });
  if (opts.postId) {
    await redis.zAdd(keys.userPosts(username), {
      member: opts.postId,
      score: now,
    });
    if (opts.authored)
      await redis.zAdd(keys.userAuthored(username), {
        member: opts.postId,
        score: now,
      });
  }
  await Promise.all(
    [
      keys.user(username),
      keys.streakRuns(username),
      keys.userPosts(username),
      keys.userAuthored(username),
    ].map((k) => redis.expire(k, RETENTION_S).catch(() => undefined))
  );
};

/** Expire a closed post's per-user vote mapping after the grace period. */
export const expireClosedVotes = async (
  key: string,
  closesAt: number,
  now = Date.now()
) => {
  const at = closesAt + CLOSED_POST_VOTES_DAYS * 86400_000;
  await redis.expire(key, Math.max(60, Math.ceil((at - now) / 1000)));
};

const allMembers = async (key: string): Promise<string[]> => {
  const out: string[] = [];
  // zRange by rank has no cap; page anyway to keep requests small.
  for (let start = 0; ; start += 500) {
    const page = await redis.zRange(key, start, start + 499, { by: 'rank' });
    out.push(...page.map((p) => p.member));
    if (page.length < 500) return out;
  }
};

/** Remove every trace of a user; null their author fields. */
export const purgeUser = async (username: string): Promise<void> => {
  for (const postId of await allMembers(keys.userPosts(username))) {
    await Promise.all([
      redis.hDel(keys.votes(postId), [username]),
      redis.hDel(keys.eloGuesses(postId), [username]),
      redis.hDel(keys.attempts(postId), PURGE_FIELDS(username)),
    ]);
  }
  for (const postId of await allMembers(keys.userAuthored(username))) {
    const post = await getPost(postId);
    if (
      (post?.kind === 'review' || post?.kind === 'elo') &&
      post.author === username
    )
      await putPost(postId, { ...post, author: null });
  }
  const latest = toInt(await redis.get(keys.latest('daily')));
  await Promise.all([
    redis.zRem(keys.leaderboard('rating'), [username]),
    redis.zRem(keys.leaderboard('solved'), [username]),
    redis.zRem(keys.leaderboard('elo'), [username]),
    redis.zRem(keys.streakBoard(latest), [username]),
    redis.zRem(keys.streakBoard(latest - 1), [username]),
    redis.hDel(keys.banned, [username]),
  ]);
  // Moderator names recorded on removals.
  const banned = await redis.hGetAll(keys.banned);
  for (const [target, raw] of Object.entries(banned)) {
    if (raw.includes(`"by":${JSON.stringify(username)}`)) {
      const rec = parseJson(raw);
      const at = typeof rec === 'object' && rec ? Reflect.get(rec, 'at') : null;
      await redis.hSet(keys.banned, {
        [target]: JSON.stringify({ by: null, at }),
      });
    }
  }
  await redis.del(
    keys.user(username),
    keys.streakRuns(username),
    keys.userPosts(username),
    keys.userAuthored(username)
  );
  await redis.zRem(keys.knownUsers, [username]);
};

/** Does Reddit still return this account? null = could not tell (retry later). */
const accountExists = async (username: string): Promise<boolean | null> => {
  try {
    const user = await reddit.getUserByUsername(username);
    return user !== undefined && user !== null;
  } catch (e) {
    console.error(`account check for ${username} failed: ${e}`);
    return null;
  }
};

/**
 * One hourly batch: check the next few known users; purge deleted accounts
 * and anyone inactive past the retention window.
 */
export const sweepUsers = async (
  now: number = Date.now()
): Promise<string[]> => {
  await backfillKnownUsers();
  const total = await redis.zCard(keys.knownUsers);
  if (total === 0) return [];
  let cursor = toInt(await redis.get(keys.sweepCursor));
  if (cursor >= total) cursor = 0;
  const size = sweepBatchSize(total);
  const batch = await redis.zRange(keys.knownUsers, cursor, cursor + size - 1, {
    by: 'rank',
  });
  const purged: string[] = [];
  for (let i = 0; i < batch.length; i += SWEEP_CHUNK) {
    const chunk = batch.slice(i, i + SWEEP_CHUNK);
    const gone = await Promise.all(
      chunk.map(
        async ({ member, score }) =>
          now - score > RETENTION_S * 1000 ||
          (await accountExists(member)) === false
      )
    );
    for (const [j, entry] of chunk.entries()) {
      if (!gone[j]) continue;
      await purgeUser(entry.member);
      purged.push(entry.member);
    }
  }
  // Purged users shift ranks down; step past only the ones kept.
  await redis.set(
    keys.sweepCursor,
    String(cursor + batch.length - purged.length)
  );
  return purged;
};

/**
 * Upgrade safety: installs from before tracking existed. Seed the known set
 * once from the leaderboards (the only cross-post index of users we had).
 */
const backfillKnownUsers = async () => {
  if ((await redis.hSetNX(keys.migrations, 'knownUsers', '1')) !== 1) return;
  const now = Date.now();
  for (const kind of ['rating', 'solved', 'elo'] as const) {
    for (const name of await allMembers(keys.leaderboard(kind)))
      await redis.zAdd(keys.knownUsers, { member: name, score: now });
  }
};
