import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type { InitResponse } from '../shared/api';
import { postDailyPuzzle, postEloGame } from './core/daily';
import { advanceGame, startGame } from './core/game';
import { createPollPost } from './core/posts';
import {
  purgeUser,
  RETENTION_DAYS,
  SWEEP_BATCH,
  SWEEP_CAP,
  sweepBatchSize,
  sweepUsers,
} from './core/privacy';
import { getPost, keys } from './core/store';
import { as, asMod, at, call, row, stubUserActions } from './test-utils';

const test = createDevvitTest({ settings: { pinDailyPuzzle: 'off' } });
type Headers = Record<string, string | undefined>;

const TWO = row(
  'two',
  '2r3k1/p4ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1',
  'a7a6 d2d8 c8d8 d1d8'
);
const SET = { easy: [TWO], medium: [TWO], hard: [TWO] };
const ELO = [
  [
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0',
    '600+0',
    '1-0',
    1510,
    1490,
  ],
];
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PGN =
  '[White "A"]\n[Black "B"]\n[WhiteElo "1200"]\n[BlackElo "1300"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0';

const post = (
  h: Headers,
  u: string,
  path: string,
  body: unknown,
  postId?: string
) =>
  as(h, { username: u, ...(postId ? { postId } : {}) }, () =>
    call('POST', path, body)
  );

/** "gone" leaves Reddit; everyone else still exists. */
const onlyGoneIsDeleted = (gone: string[]) =>
  vi
    .spyOn(reddit, 'getUserByUsername')
    .mockImplementation(async (name: string) =>
      gone.includes(name)
        ? undefined
        : ({ username: name } as unknown as Awaited<
            ReturnType<typeof reddit.getUserByUsername>
          >)
    );

describe('account deletion purge', () => {
  test('removes every trace of a user and nulls their author fields', async ({
    headers,
  }) => {
    stubUserActions();
    // Puzzle: solve (rating, streak, leaderboards, attempts, timing).
    const p = await postDailyPuzzle(at('2026-11-02', 13), SET);
    if (p.status !== 'posted') throw new Error('no puzzle');
    await as(headers, { username: 'gone', postId: p.postId }, () =>
      call('GET', '/api/init')
    );
    await post(
      headers,
      'gone',
      '/api/puzzle/move',
      { moves: ['d2d8'] },
      p.postId
    );
    await post(
      headers,
      'gone',
      '/api/puzzle/move',
      { moves: ['d2d8', 'd1d8'] },
      p.postId
    );
    // Poll vote, Elo guess, community game vote, own review and Elo posts.
    const poll = await createPollPost({
      position: START,
      prompt: '',
      closeHours: 0,
      orientation: 'auto',
    });
    if (!poll.ok) throw new Error('no poll');
    await post(
      headers,
      'gone',
      '/api/poll/vote',
      { move: 'e2e4' },
      poll.postId
    );
    const e = await postEloGame(at('2026-10-31', 13), ELO);
    if (e.status !== 'posted') throw new Error('no elo');
    await post(headers, 'gone', '/api/elo/guess', { guess: 1500 }, e.postId);
    const g = await startGame(at('2026-11-02', 9));
    if (!g.ok) throw new Error('no game');
    await post(headers, 'gone', '/api/game/vote', { move: 'e2e4' }, g.postId);
    const review = await post(headers, 'gone', '/api/review/create', {
      pgnOrUrl: PGN,
      caption: '',
    });
    const mine = await post(headers, 'gone', '/api/elo/create', {
      pgnOrUrl: PGN,
      caption: '',
    });
    const reviewId = (review.json as { postId: string }).postId;
    const eloId = (mine.json as { postId: string }).postId;
    // A mod removal by "gone" of someone else, and a removal of "gone".
    asMod();
    await post(headers, 'gone', '/api/leaderboard/remove', {
      username: 'cheater',
    });
    await post(headers, 'mod', '/api/leaderboard/remove', { username: 'gone' });
    vi.restoreAllMocks();

    await purgeUser('gone');

    const dump = async () => {
      const out: string[] = [];
      for (const k of [
        keys.user('gone'),
        keys.streakRuns('gone'),
        keys.userPosts('gone'),
        keys.userAuthored('gone'),
      ])
        out.push(String(await redis.exists(k)));
      for (const id of [p.postId, poll.postId, e.postId, g.postId])
        out.push(
          JSON.stringify(await redis.hGetAll(keys.votes(id))),
          JSON.stringify(await redis.hGetAll(keys.attempts(id))),
          JSON.stringify(await redis.hGetAll(keys.eloGuesses(id)))
        );
      for (const lb of ['rating', 'solved', 'elo'] as const)
        out.push(
          JSON.stringify(
            await redis.zRange(keys.leaderboard(lb), 0, -1, { by: 'rank' })
          )
        );
      out.push(
        JSON.stringify(
          await redis.zRange(keys.streakBoard(1), 0, -1, { by: 'rank' })
        )
      );
      out.push(JSON.stringify(await redis.hGetAll(keys.banned)));
      out.push(
        JSON.stringify(
          await redis.zRange(keys.knownUsers, 0, -1, { by: 'rank' })
        )
      );
      out.push(
        JSON.stringify(await getPost(reviewId)),
        JSON.stringify(await getPost(eloId))
      );
      return out.join('\n');
    };
    const text = await dump();
    expect(text).not.toContain('gone');
    expect(await redis.exists(keys.user('gone'))).toBe(0);
    expect(await getPost(reviewId)).toMatchObject({
      kind: 'review',
      author: null,
    });
    expect(await getPost(eloId)).toMatchObject({ kind: 'elo', author: null });
    // The removal "gone" made keeps its target but loses the moderator name.
    expect(
      JSON.parse((await redis.hGet(keys.banned, 'cheater')) ?? '{}')
    ).toMatchObject({ by: null });
    // Aggregates stay: the poll still shows one vote for e4.
    const v = await as(
      headers,
      { username: 'other', postId: poll.postId },
      () => call('GET', '/api/init')
    );
    expect((v.json as InitResponse).post).toMatchObject({ totalVotes: 1 });
  });
});

describe('hourly sweep', () => {
  test('purges accounts Reddit no longer returns, keeps the rest', async ({
    headers,
  }) => {
    const p = await postDailyPuzzle(at('2026-11-02', 13), SET);
    if (p.status !== 'posted') throw new Error('no puzzle');
    for (const u of ['gone', 'stays'])
      await post(headers, u, '/api/puzzle/move', { moves: ['d2d7'] }, p.postId);
    onlyGoneIsDeleted(['gone']);
    expect(await sweepUsers()).toEqual(['gone']);
    expect(await redis.zScore(keys.knownUsers, 'stays')).toBeDefined();
    expect(await redis.exists(keys.user('stays'))).toBe(1);
    expect(await redis.exists(keys.user('gone'))).toBe(0);
  });

  test('a failed lookup is retried later, never treated as deleted', async ({
    headers,
  }) => {
    const p = await postDailyPuzzle(at('2026-11-02', 13), SET);
    if (p.status !== 'posted') throw new Error('no puzzle');
    await post(
      headers,
      'flaky',
      '/api/puzzle/move',
      { moves: ['d2d7'] },
      p.postId
    );
    vi.spyOn(reddit, 'getUserByUsername').mockRejectedValue(
      new Error('timeout')
    );
    expect(await sweepUsers()).toEqual([]);
    expect(await redis.exists(keys.user('flaky'))).toBe(1);
  });

  test('purges users inactive past the retention window', async () => {
    onlyGoneIsDeleted([]);
    const old = Date.now() - (RETENTION_DAYS + 1) * 86400_000;
    await redis.zAdd(
      keys.knownUsers,
      { member: 'idle', score: old },
      { member: 'active', score: Date.now() }
    );
    await redis.hSet(keys.user('idle'), { rating: '1600' });
    expect(await sweepUsers()).toEqual(['idle']);
    expect(await redis.exists(keys.user('idle'))).toBe(0);
  });

  test('rotates through users in small batches', async () => {
    const spy = onlyGoneIsDeleted([]);
    const now = Date.now();
    for (let i = 0; i < SWEEP_BATCH + 5; i++)
      await redis.zAdd(keys.knownUsers, {
        member: `u${String(i).padStart(3, '0')}`,
        score: now + i,
      });
    await sweepUsers(now);
    expect(spy).toHaveBeenCalledTimes(SWEEP_BATCH);
    await sweepUsers(now);
    expect(spy).toHaveBeenCalledTimes(SWEEP_BATCH + 5);
    await sweepUsers(now); // wraps around
    expect(spy).toHaveBeenCalledTimes(2 * SWEEP_BATCH + 5);
  });

  test('upgrade: seeds known users once from existing leaderboards', async () => {
    onlyGoneIsDeleted(['oldtimer']);
    await redis.zAdd(keys.leaderboard('solved'), {
      member: 'oldtimer',
      score: 3,
    });
    await redis.hSet(keys.user('oldtimer'), { solved: '3' });
    expect(await sweepUsers()).toEqual(['oldtimer']);
    expect(await redis.zCard(keys.leaderboard('solved'))).toBe(0);
    expect(await redis.hGet(keys.migrations, 'knownUsers')).toBe('1');
  });
});

describe('retention', () => {
  test('activity sets a long inactivity TTL on per-user data', async ({
    headers,
  }) => {
    const p = await postDailyPuzzle(at('2026-11-02', 13), SET);
    if (p.status !== 'posted') throw new Error('no puzzle');
    await post(
      headers,
      'ttl',
      '/api/puzzle/move',
      { moves: ['d2d7'] },
      p.postId
    );
    const left =
      (await redis.expireTime(keys.user('ttl'))) -
      Math.floor(Date.now() / 1000);
    expect(left).toBeGreaterThan((RETENTION_DAYS - 1) * 86400);
  });

  test('closed polls drop who voted after 30 days but keep the counts', async ({
    headers,
  }) => {
    const poll = await createPollPost({
      position: START,
      prompt: '',
      closeHours: 1,
      orientation: 'auto',
    });
    if (!poll.ok) throw new Error('no poll');
    await post(headers, 'v', '/api/poll/vote', { move: 'e2e4' }, poll.postId);
    const left =
      (await redis.expireTime(keys.votes(poll.postId))) -
      Math.floor(Date.now() / 1000);
    expect(left).toBeGreaterThan(30 * 86400);
    expect(left).toBeLessThan(31 * 86400);
    expect(
      await redis.expireTime(keys.counts(poll.postId))
    ).toBeLessThanOrEqual(0);
  });

  test('closed community game posts drop who voted; results stay', async ({
    headers,
  }) => {
    const g = await startGame(at('2026-11-01', 9));
    if (!g.ok) throw new Error('no game');
    await post(headers, 'v', '/api/game/vote', { move: 'e2e4' }, g.postId);
    await advanceGame(at('2026-11-02', 13));
    expect(await redis.expireTime(keys.votes(g.postId))).toBeGreaterThan(0);
    await redis.del(keys.votes(g.postId), keys.counts(g.postId)); // as after expiry
    const v = await as(headers, { username: 'x', postId: g.postId }, () =>
      call('GET', '/api/init')
    );
    expect((v.json as InitResponse).post).toMatchObject({
      status: 'closed',
      results: [{ move: 'e2e4', votes: 1 }],
    });
  });
});

describe('adaptive sweep size', () => {
  test('covers everyone within 30 days, between the floor and the cap', () => {
    expect(sweepBatchSize(0)).toBe(SWEEP_BATCH);
    expect(sweepBatchSize(10_000)).toBe(SWEEP_BATCH); // 14/hour needed
    expect(sweepBatchSize(50_000)).toBe(70); // ceil(50000 / 720)
    expect(sweepBatchSize(50_000) * 720).toBeGreaterThanOrEqual(50_000);
    expect(sweepBatchSize(10_000_000)).toBe(SWEEP_CAP);
  });

  test('a big install checks the larger batch in one run', async () => {
    const spy = onlyGoneIsDeleted(['u00005']);
    const now = Date.now();
    const n = 720 * 30; // needs 30 per hour
    const members = Array.from({ length: n }, (_, i) => ({
      member: `u${String(i).padStart(5, '0')}`,
      score: now,
    }));
    for (let i = 0; i < members.length; i += 1000)
      await redis.zAdd(keys.knownUsers, ...members.slice(i, i + 1000));
    expect(await sweepUsers(now)).toEqual(['u00005']);
    expect(spy).toHaveBeenCalledTimes(30);
    expect(await redis.get(keys.sweepCursor)).toBe('29');
  });
});
