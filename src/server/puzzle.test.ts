import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type {
  InitResponse,
  LeaderboardResponse,
  PuzzleHintResponse,
  PuzzleMoveResponse,
  PuzzleRevealResponse,
} from '../shared/api';
import { postDailyPuzzle } from './core/daily';
import type { PuzzleSet } from './core/puzzles';
import { keys } from './core/store';
import { as, asMod, at, call, row } from './test-utils';

const test = createDevvitTest({ settings: { pinDailyPuzzle: 'off' } });
type Headers = Record<string, string | undefined>;

// Two solver moves: 1. Rd8+ Rxd8 2. Rxd8#.
const TWO = row(
  'two',
  '2r3k1/p4ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1',
  'a7a6 d2d8 c8d8 d1d8'
);
// One move, two mates (Qd8# is the stored answer, Re8# also mates).
const ALT = row('alt', '7k/p5pp/8/8/8/8/6PP/3QR1K1 b - - 0 1', 'a7a6 d1d8');
const only = (r: unknown[]): PuzzleSet => ({
  easy: [r],
  medium: [r],
  hard: [r],
});

const postPuzzle = async (day: number, set: PuzzleSet = only(TWO)) => {
  const res = await postDailyPuzzle(
    at(`2026-11-${String(day).padStart(2, '0')}`, 13),
    set
  );
  if (res.status !== 'posted') throw new Error(JSON.stringify(res));
  return res.postId;
};

const json = <T>(r: { status: number; json: unknown }): T => {
  expect(r.status).toBe(200);
  return JSON.parse(JSON.stringify(r.json));
};
const move = (h: Headers, u: string | null, postId: string, moves: unknown) =>
  as(h, { username: u, postId }, () =>
    call('POST', '/api/puzzle/move', { moves })
  );
const hint = (h: Headers, u: string | null, postId: string, moves: unknown) =>
  as(h, { username: u, postId }, () =>
    call('POST', '/api/puzzle/hint', { moves })
  );
const reveal = (h: Headers, u: string | null, postId: string) =>
  as(h, { username: u, postId }, () => call('POST', '/api/puzzle/reveal', {}));
const init = async (h: Headers, u: string | null, postId: string) =>
  json<InitResponse>(
    await as(h, { username: u, postId }, () => call('GET', '/api/init'))
  );

/** Play the whole correct line; returns the final response. */
const solve = async (h: Headers, u: string | null, postId: string) => {
  await move(h, u, postId, ['d2d8']);
  return json<PuzzleMoveResponse>(await move(h, u, postId, ['d2d8', 'd1d8']));
};

describe('puzzle view', () => {
  test('never sends the solution before the viewer finishes', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const view = (await init(headers, 'ann', id)).post;
    expect(view).toMatchObject({
      kind: 'puzzle',
      puzzle: {
        setupMove: 'a7a6',
        solverMoves: 2,
        solution: null,
        themes: null,
      },
      me: { status: 'unsolved' },
    });
    expect(JSON.stringify(view)).not.toContain('d1d8');
    expect((await init(headers, null, id)).post).toMatchObject({ me: null });
  });
});

describe('POST /api/puzzle/move', () => {
  test('a clean solve: replies, then done with the solution and a rating win', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const first = json<PuzzleMoveResponse>(
      await move(headers, 'ann', id, ['d2d8'])
    );
    expect(first).toMatchObject({
      correct: true,
      reply: 'c8d8',
      done: false,
      me: null,
      solution: null,
    });
    const done = json<PuzzleMoveResponse>(
      await move(headers, 'ann', id, ['d2d8', 'd1d8'])
    );
    expect(done).toMatchObject({
      correct: true,
      done: true,
      reply: null,
      solution: ['a7a6', 'd2d8', 'c8d8', 'd1d8'],
      themes: ['mate'],
      me: { status: 'solved', cleanSolve: true, solvedTotal: 1, streak: 1 },
      stats: { attempts: 1, cleanSolves: 1 },
    });
    expect(done.ratingDelta).toBeGreaterThan(0);
    expect((await init(headers, 'ann', id)).post).toMatchObject({
      puzzle: { solution: ['a7a6', 'd2d8', 'c8d8', 'd1d8'] },
    });
  });

  test('the first wrong move is a failed first attempt; a later solve still counts as solved', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const miss = json<PuzzleMoveResponse>(
      await move(headers, 'bob', id, ['d2d7'])
    );
    expect(miss).toMatchObject({
      correct: false,
      done: false,
      me: { status: 'failed', cleanSolve: false },
    });
    expect(miss.ratingDelta).toBeLessThan(0);
    // A second miss changes nothing.
    expect(
      json<PuzzleMoveResponse>(await move(headers, 'bob', id, ['d2d7']))
        .ratingDelta
    ).toBe(0);
    const done = await solve(headers, 'bob', id);
    expect(done).toMatchObject({
      done: true,
      ratingDelta: 0,
      me: { status: 'solved', cleanSolve: false, solvedTotal: 1, streak: 1 },
      stats: { attempts: 1, cleanSolves: 0 },
    });
  });

  test('accepts any mate on the final move', async ({ headers }) => {
    const id = await postPuzzle(1, only(ALT));
    const r = json<PuzzleMoveResponse>(await move(headers, 'cy', id, ['e1e8']));
    expect(r).toMatchObject({
      correct: true,
      done: true,
      me: { cleanSolve: true },
    });
  });

  test('rejects malformed lines without recording anything', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    for (const bad of [
      [],
      ['d2d7', 'd1d8'],
      ['d2d8', 'd1d8', 'a2a3'],
      ['zz'],
      ['e2e4'],
      'd2d8',
      [7],
    ])
      expect((await move(headers, 'dee', id, bad)).status).toBe(400);
    expect((await init(headers, 'dee', id)).post).toMatchObject({
      me: { status: 'unsolved', rating: 1500 },
      stats: { attempts: 0 },
    });
  });

  test('logged-out viewers can play moves but learn nothing beyond right or wrong', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const first = json<PuzzleMoveResponse>(
      await move(headers, null, id, ['d2d8'])
    );
    expect(first).toMatchObject({
      correct: true,
      reply: 'c8d8',
      done: false,
      me: null,
    });
    const done = json<PuzzleMoveResponse>(
      await move(headers, null, id, ['d2d8', 'd1d8'])
    );
    expect(done).toMatchObject({
      correct: true,
      done: true,
      me: null,
      solution: null,
      themes: null,
    });
    const miss = json<PuzzleMoveResponse>(
      await move(headers, null, id, ['d2d7'])
    );
    expect(miss).toMatchObject({
      correct: false,
      reply: null,
      done: false,
      me: null,
      solution: null,
    });
    for (const r of [
      await hint(headers, null, id, []),
      await reveal(headers, null, id),
    ]) {
      expect(r.status).toBe(401);
      expect(r.json).toMatchObject({ message: 'Log in to solve.' });
    }
    await solve(headers, 'someone', id); // others finishing changes nothing
    const view = (await init(headers, null, id)).post;
    expect(view).toMatchObject({
      puzzle: { solution: null, themes: null },
      me: null,
      stats: { attempts: 1 },
    });
    expect(JSON.stringify(view)).not.toContain('d1d8');
  });

  test('30 users finishing at once are each counted exactly once', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const users = Array.from({ length: 30 }, (_, i) => `u${i}`);
    await Promise.all(users.map((u) => move(headers, u, id, ['d2d8'])));
    const rs = await Promise.all(
      users.map((u) => move(headers, u, id, ['d2d8', 'd1d8']))
    );
    for (const r of rs)
      expect(json<PuzzleMoveResponse>(r).me?.cleanSolve).toBe(true);
    expect((await init(headers, null, id)).post).toMatchObject({
      stats: { attempts: 30, cleanSolves: 30 },
    });
    const board = json<LeaderboardResponse>(
      await as(headers, { username: 'u0' }, () =>
        call('GET', '/api/leaderboard?kind=solved')
      )
    );
    expect(board.entries).toHaveLength(25);
  });

  test('duplicate simultaneous finishes by one user count once', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    await move(headers, 'eve', id, ['d2d8']);
    const rs = await Promise.all(
      Array.from({ length: 6 }, () =>
        move(headers, 'eve', id, ['d2d8', 'd1d8'])
      )
    );
    const deltas = rs.map((r) => json<PuzzleMoveResponse>(r).ratingDelta);
    expect(deltas.filter((d) => d !== 0)).toHaveLength(1);
    expect((await init(headers, 'eve', id)).post).toMatchObject({
      stats: { attempts: 1, cleanSolves: 1 },
      me: { solvedTotal: 1 },
    });
  });

  test('rate limits move and hint calls per user', async ({ headers }) => {
    const id = await postPuzzle(1);
    let last = 0;
    for (let i = 0; i < 121; i++)
      last = (await move(headers, 'spam', id, ['d2d8'])).status;
    expect(last).toBe(429);
    expect((await move(headers, 'other', id, ['d2d8'])).status).toBe(200);
  });
});

describe('hints and reveal', () => {
  test('a hint on the first attempt is a rated loss; finishing still counts as solved', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    expect(
      json<PuzzleHintResponse>(await hint(headers, 'fay', id, []))
    ).toEqual({
      type: 'puzzleHint',
      move: 'd2d8',
    });
    expect(
      json<PuzzleHintResponse>(await hint(headers, 'fay', id, ['d2d8'])).move
    ).toBe('d1d8');
    const done = await solve(headers, 'fay', id);
    expect(done).toMatchObject({
      ratingDelta: 0, // the loss was taken at the hint
      me: { status: 'solved', cleanSolve: false, solvedTotal: 1 },
      stats: { attempts: 1, cleanSolves: 0 },
    });
    expect(done.me?.rating).toBeLessThan(1500);
  });

  test('hints need a correct line that is not finished', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    expect((await hint(headers, 'g', id, ['d2d7'])).status).toBe(400);
    expect((await hint(headers, 'g', id, ['d2d8', 'd1d8'])).status).toBe(400);
    expect((await hint(headers, 'g', id, 'x')).status).toBe(400);
  });

  test('a hint after a clean solve changes nothing', async ({ headers }) => {
    const id = await postPuzzle(1);
    const done = await solve(headers, 'hal', id);
    await hint(headers, 'hal', id, []);
    expect((await init(headers, 'hal', id)).post).toMatchObject({
      me: { cleanSolve: true, rating: done.me?.rating },
    });
  });

  test('revealing first is a failed attempt; later solves do not upgrade it', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    const r = json<PuzzleRevealResponse>(await reveal(headers, 'ivy', id));
    expect(r).toMatchObject({
      solution: ['a7a6', 'd2d8', 'c8d8', 'd1d8'],
      themes: ['mate'],
      me: { status: 'failed', cleanSolve: false },
      stats: { attempts: 1 },
    });
    expect(r.ratingDelta).toBeLessThan(0);
    const after = await solve(headers, 'ivy', id);
    expect(after.me).toMatchObject({
      status: 'failed',
      solvedTotal: 0,
      streak: 0,
    });
    expect((await init(headers, 'ivy', id)).post).toMatchObject({
      puzzle: { solution: expect.any(Array) },
    });
  });
});

describe('streaks', () => {
  test('grow on consecutive puzzles, ignore the backlog, and lapse after a missed day', async ({
    headers,
  }) => {
    const p1 = await postPuzzle(1);
    const p2 = await postPuzzle(2);
    const p3 = await postPuzzle(3);
    expect((await solve(headers, 'jo', p1)).me?.streak).toBe(0); // backlog
    expect((await solve(headers, 'jo', p2)).me?.streak).toBe(1); // yesterday's
    expect((await solve(headers, 'jo', p3)).me?.streak).toBe(2);
    await postPuzzle(4);
    const p5 = await postPuzzle(5);
    expect((await init(headers, 'jo', p5)).post).toMatchObject({
      me: { streak: 0, bestStreak: 2 },
    });
    expect((await solve(headers, 'jo', p5)).me).toMatchObject({
      streak: 1,
      bestStreak: 2,
    });
  });
});

describe('streak order', () => {
  test("solving today's before yesterday's keeps the streak alive", async ({
    headers,
  }) => {
    const p1 = await postPuzzle(1);
    await solve(headers, 'ola', p1);
    const p2 = await postPuzzle(2);
    await solve(headers, 'ola', p2); // streak 2
    const p3 = await postPuzzle(3);
    const p4 = await postPuzzle(4); // ola missed nothing yet: #3 is yesterday
    expect((await solve(headers, 'ola', p4)).me?.streak).toBe(1); // run ending at 4
    expect((await solve(headers, 'ola', p3)).me).toMatchObject({
      streak: 4,
      bestStreak: 4,
    });
    const board = json<LeaderboardResponse>(
      await as(headers, { username: 'ola' }, () =>
        call('GET', '/api/leaderboard?kind=streak')
      )
    );
    expect(board.me).toEqual({ rank: 1, username: 'ola', value: 4 });
  });

  test('a solve after a hint or a miss still counts; after giving up it does not', async ({
    headers,
  }) => {
    const p1 = await postPuzzle(1);
    await hint(headers, 'pat', p1, []);
    expect((await solve(headers, 'pat', p1)).me).toMatchObject({
      streak: 1,
      solvedTotal: 1,
    });
    const p2 = await postPuzzle(2);
    await reveal(headers, 'pat', p2);
    expect((await solve(headers, 'pat', p2)).me).toMatchObject({
      streak: 1,
      solvedTotal: 1,
    });
  });

  test('solving the same puzzle twice counts once', async ({ headers }) => {
    const p1 = await postPuzzle(1);
    await move(headers, 'quin', p1, ['d2d7']);
    await Promise.all([solve(headers, 'quin', p1), solve(headers, 'quin', p1)]);
    expect((await init(headers, 'quin', p1)).post).toMatchObject({
      me: { solvedTotal: 1, streak: 1 },
    });
  });
});

describe('leaderboards', () => {
  const board = async (h: Headers, u: string | null, kind: string) =>
    json<LeaderboardResponse>(
      await as(h, { username: u }, () =>
        call('GET', `/api/leaderboard?kind=${kind}`)
      )
    );

  test('streak board shows only live streaks, read from two small sets', async ({
    headers,
  }) => {
    const p1 = await postPuzzle(1);
    for (const u of ['zed', 'yan', 'xia']) await solve(headers, u, p1);
    const p2 = await postPuzzle(2);
    for (const u of ['zed', 'yan']) await solve(headers, u, p2);
    const p3 = await postPuzzle(3);
    await solve(headers, 'zed', p3);
    const streak = await board(headers, 'xia', 'streak');
    expect(streak.entries).toEqual([
      { rank: 1, username: 'zed', value: 3 },
      { rank: 2, username: 'yan', value: 2 },
    ]);
    expect(streak.me).toBeNull();
    const solved = await board(headers, 'yan', 'solved');
    expect(solved.entries.map((e) => [e.username, e.value])).toEqual([
      ['zed', 3],
      ['yan', 2],
      ['xia', 1],
    ]);
    expect(solved.me).toEqual({ rank: 2, username: 'yan', value: 2 });
    expect((await board(headers, null, 'solved')).me).toBeNull();
    const bad = await as(headers, { username: 'a' }, () =>
      call('GET', '/api/leaderboard?kind=nope')
    );
    expect(bad.status).toBe(400);
  });

  test('the rating board needs 5 rated attempts', async ({ headers }) => {
    for (let d = 1; d <= 4; d++)
      await solve(headers, 'kim', await postPuzzle(d));
    expect((await board(headers, 'kim', 'rating')).entries).toEqual([]);
    await solve(headers, 'kim', await postPuzzle(5));
    const after = await board(headers, 'kim', 'rating');
    expect(after.entries).toEqual([after.me]);
    expect(after.me?.value).toBeGreaterThan(1500);
  });

  test('mods can remove a user from every board and keep them off', async ({
    headers,
  }) => {
    const p1 = await postPuzzle(1);
    await solve(headers, 'cheat', p1);
    await solve(headers, 'fair', p1);
    const remove = (u: string | null, target: unknown) =>
      as(headers, { username: u }, () =>
        call('POST', '/api/leaderboard/remove', { username: target })
      );
    expect((await remove(null, 'cheat')).status).toBe(401);
    expect((await remove('fair', 'cheat')).status).toBe(403);
    asMod();
    expect((await remove('mod', 'not a name!')).status).toBe(400);
    expect(json(await remove('mod', 'u/cheat'))).toEqual({
      type: 'leaderboardRemove',
    });
    expect(
      JSON.parse((await redis.hGet(keys.banned, 'cheat')) ?? '{}')
    ).toMatchObject({ by: 'mod' });
    for (const kind of ['solved', 'streak'])
      expect(
        (await board(headers, 'x', kind)).entries.map((e) => e.username)
      ).toEqual(['fair']);
    // Solving again does not bring them back.
    await solve(headers, 'cheat', await postPuzzle(2));
    expect(
      (await board(headers, 'x', 'solved')).entries.map((e) => e.username)
    ).toEqual(['fair']);
  });
});

describe('solve timing (internal)', () => {
  test('records first view, first move and finish once, and never returns them', async ({
    headers,
  }) => {
    const id = await postPuzzle(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-11-01', 14));
      const view = await init(headers, 'tim', id);
      vi.setSystemTime(new Date(at('2026-11-01', 14).getTime() + 4000));
      await move(headers, 'tim', id, ['d2d8']);
      vi.setSystemTime(new Date(at('2026-11-01', 14).getTime() + 9000));
      const done = await move(headers, 'tim', id, ['d2d8', 'd1d8']);
      await init(headers, 'tim', id); // a later view does not reset the clock
      await move(headers, 'tim', id, ['d2d8']);
      const k = keys.attempts(id);
      expect(await redis.hGet(k, 't0:tim')).toBe(
        String(at('2026-11-01', 14).getTime())
      );
      expect(await redis.hGet(k, 'tm:tim')).toBe('4000');
      expect(await redis.hGet(k, 'tf:tim')).toBe('9000');
      expect(JSON.stringify([view, done.json])).not.toMatch(
        /t0:|tm:|tf:|"timing/
      );
    } finally {
      vi.useRealTimers();
    }
    // Logged-out play records nothing; deleting the post removes it all.
    await move(headers, null, id, ['d2d8']);
    expect(await redis.hGet(keys.attempts(id), 't0:null')).toBeUndefined();
    await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: id,
    });
    expect(await redis.exists(keys.attempts(id))).toBe(0);
  });
});
