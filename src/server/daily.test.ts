import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import { postDailyPuzzle, postEloGame, solverView } from './core/daily';
import { rowToPuzzle, type PuzzleSet } from './core/puzzles';
import { bucketFor } from './core/settings';
import { getPost, keys } from './core/store';
import { SET, at, call, row } from './test-utils';

const test = createDevvitTest();

const storedPuzzleId = async (postId: string) => {
  const p = await getPost(postId);
  return p?.kind === 'puzzle' ? p.puzzle.id : null;
};

describe('bucketFor', () => {
  test('difficulty follows the weekday', () => {
    // 2026-10-26 is a Monday.
    const days = [
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ];
    expect(days.map((d) => bucketFor(d))).toEqual([
      'easy',
      'easy',
      'medium',
      'medium',
      'medium',
      'hard',
      'hard',
    ]);
  });
});

describe('postDailyPuzzle', () => {
  test('posts the first puzzle with the right title and post data', async ({
    mocks,
  }) => {
    const res = await postDailyPuzzle(at('2026-10-29', 13), SET);
    if (res.status !== 'posted') throw new Error(JSON.stringify(res));
    expect(res.number).toBe(1);
    const post = await reddit.getPostById(res.postId as `t3_${string}`);
    expect(post.title).toBe('Daily Puzzle #1 · White to move · Oct 29');
    expect(mocks.reddit.linksAndComments.getPostData(res.postId)).toEqual({
      kind: 'puzzle',
      fen: '6k1/5ppp/p7/8/8/8/5PPP/3R2K1 w - - 0 2',
      orientation: 'white',
      card: expect.objectContaining({ kind: 'puzzle', number: 1 }),
    });
    expect(await redis.get(keys.latest('daily'))).toBe('1');
  });

  test('concurrent runs on one date post exactly once', async () => {
    const now = at('2026-10-29', 13);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => postDailyPuzzle(now, SET))
    );
    expect(results.filter((r) => r.status === 'posted')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'exists')).toHaveLength(5);
    expect(await redis.get(keys.latest('daily'))).toBe('1');
    expect(await redis.get(keys.cursor('daily', 'medium'))).toBe('1');
  });

  test('a repeat call later the same UTC day does nothing', async () => {
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    const again = await postDailyPuzzle(at('2026-10-29', 23), SET);
    expect(again.status).toBe('exists');
    expect(await redis.get(keys.latest('daily'))).toBe('1');
  });

  test('never repeats a puzzle until the bucket is used up, then wraps', async () => {
    const ids: (string | null)[] = [];
    const numbers: number[] = [];
    // Mondays and Tuesdays only, so every post draws from the easy bucket.
    for (const date of [
      '2026-11-02',
      '2026-11-03',
      '2026-11-09',
      '2026-11-10',
    ]) {
      const res = await postDailyPuzzle(at(date, 13), SET);
      if (res.status !== 'posted') throw new Error(JSON.stringify(res));
      ids.push(await storedPuzzleId(res.postId));
      numbers.push(res.number);
    }
    expect(numbers).toEqual([1, 2, 3, 4]);
    expect(ids).toEqual(['e1', 'e2', 'e3', 'e1']);
  });

  test('each bucket has its own cursor', async () => {
    await redis.set(keys.cursor('daily', 'easy'), '2');
    // 2026-11-01 is a Sunday: hard.
    const res = await postDailyPuzzle(at('2026-11-01', 13), SET);
    if (res.status !== 'posted') throw new Error(JSON.stringify(res));
    expect(await storedPuzzleId(res.postId)).toBe('e1');
    expect(await redis.get(keys.cursor('daily', 'easy'))).toBe('2');
    expect(await redis.get(keys.cursor('daily', 'hard'))).toBe('1');
  });

  test('a failed post releases the date and consumes no number or puzzle', async () => {
    vi.spyOn(reddit, 'submitCustomPost').mockRejectedValueOnce(
      new Error('boom')
    );
    const failed = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(failed.status).toBe('error');
    expect(await redis.get(keys.latest('daily'))).toBeUndefined();

    const retry = await postDailyPuzzle(at('2026-10-29', 14), SET);
    if (retry.status !== 'posted') throw new Error(JSON.stringify(retry));
    expect(retry.number).toBe(1);
    expect(await storedPuzzleId(retry.postId)).toBe('e1');
  });

  test('posts carry the feed card height (Reddit stores it per post)', async () => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ styles: { heightPixels: 264 } })
    );
  });

  test('posts carry the feed card text (shown before /api/init)', async () => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    const elo = [['1. e4 e5 2. Nf3 Nc6 1-0', '180+2', '1-0', 1510, 1490]];
    await postEloGame(at('2026-10-31', 13), elo);
    const [puzzle, guess] = submit.mock.calls.map(([o]) => o.postData);
    expect(puzzle).toMatchObject({
      kind: 'puzzle',
      card: { kind: 'puzzle', number: 1, tagline: null, anarchy: false },
    });
    expect(puzzle?.['card']).toHaveProperty('rating', expect.any(Number));
    expect(guess).toMatchObject({
      card: { kind: 'elo', number: 1, timeControl: '180+2' },
    });
    // Well under Reddit's 2 KB postData limit.
    for (const d of [puzzle, guess])
      expect(JSON.stringify(d).length).toBeLessThan(600);
  });

  test('a failure after the post is created never releases the date or double-posts', async () => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    vi.spyOn(redis, 'mSet').mockRejectedValue(new Error('redis down'));
    const first = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(first.status).toBe('posted'); // best-effort writes failed, post stands
    if (first.status !== 'posted') return;
    expect(await redis.hGet(keys.dates('daily'), '2026-10-29')).toBe(
      first.postId
    );
    expect((await getPost(first.postId))?.kind).toBe('puzzle');

    const again = await postDailyPuzzle(at('2026-10-29', 14), SET);
    expect(again).toEqual({ status: 'exists', postId: first.postId });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test('even if recording the post fails, the date stays claimed', async () => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    vi.spyOn(redis, 'hSet').mockRejectedValue(new Error('redis down'));
    const first = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(first.status).toBe('posted');
    vi.restoreAllMocks();
    // Still pending (fresh claim): no second post within the claim window.
    const again = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(again.status).toBe('exists');
    expect(submit).not.toHaveBeenCalledTimes(2);
  });

  test('a stale claim from a crashed run is taken over, a fresh one is not', async () => {
    await redis.hSet(keys.dates('daily'), {
      '2026-10-29': `pending:${at('2026-10-29', 13).getTime()}`,
    });
    const fresh = await postDailyPuzzle(
      new Date(at('2026-10-29', 13).getTime() + 60_000),
      SET
    );
    expect(fresh.status).toBe('exists');
    const stale = await postDailyPuzzle(at('2026-10-29', 14), SET);
    expect(stale.status).toBe('posted');
  });

  test('skips malformed puzzles', async () => {
    const bad: PuzzleSet = {
      ...SET,
      medium: [
        row('bad', '6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', 'a7a1 d1d8'),
        ...SET.medium,
      ],
    };
    const res = await postDailyPuzzle(at('2026-10-29', 13), bad);
    if (res.status !== 'posted') throw new Error(JSON.stringify(res));
    expect(await storedPuzzleId(res.postId)).toBe('e1');
    expect(await redis.get(keys.cursor('daily', 'medium'))).toBe('2');
  });
});

describe('solverView', () => {
  test('applies the setup move and reports the solver side', () => {
    const p = rowToPuzzle(
      row('x', '6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', 'a7a6 d1d8')
    );
    expect(p && solverView(p)?.side).toBe('white');
  });
});

describe('scheduler task and install trigger', () => {
  test('hourly task waits for the configured hour and posts once per day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const run = async (d: Date) => {
        vi.setSystemTime(d);
        return call('POST', '/internal/scheduler/daily-puzzle', {});
      };
      // Default post hour is 13 UTC (settings fixture has no override).
      await run(at('2026-10-29', 12));
      expect(await redis.get(keys.latest('daily'))).toBeUndefined();
      await run(at('2026-10-29', 13));
      expect(await redis.get(keys.latest('daily'))).toBe('1');
      await run(at('2026-10-29', 14));
      await run(at('2026-10-29', 23));
      expect(await redis.get(keys.latest('daily'))).toBe('1');
      await run(at('2026-10-30', 13));
      expect(await redis.get(keys.latest('daily'))).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });

  const off = createDevvitTest({ settings: { dailyPuzzle: false } });
  off('does nothing when the daily puzzle is disabled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-29', 20));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('daily'))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  const late = createDevvitTest({ settings: { postHourUtc: 5 } });
  late('honours a custom post hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-29', 4));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('daily'))).toBeUndefined();
      vi.setSystemTime(at('2026-10-29', 5));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('daily'))).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  test('install posts Daily Puzzle #1 and the menu then points at it', async () => {
    const res = await call('POST', '/internal/triggers/on-app-install', {
      type: 'AppInstall',
    });
    expect(res.status).toBe(200);
    expect(await redis.get(keys.latest('daily'))).toBe('1');
    const menu = await call('POST', '/internal/menu/daily-post', {});
    expect(menu.json).toMatchObject({
      showToast: expect.stringContaining('already'),
    });
    expect(menu.json).toHaveProperty('navigateTo');
    expect(await redis.get(keys.latest('daily'))).toBe('1');
  });

  test("menu posts today's puzzle when none exists", async () => {
    const menu = await call('POST', '/internal/menu/daily-post', {});
    expect(menu.json).toMatchObject({
      showToast: { text: 'Posted Daily Puzzle #1' },
    });
  });
});
