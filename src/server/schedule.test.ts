import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type { InitResponse } from '../shared/api';
import { nextPuzzleAt, postDailyPuzzle, postEloGame } from './core/daily';
import { eloDue } from './core/settings';
import { getPost, keys } from './core/store';
import { SET, as, at, call } from './test-utils';

const test = createDevvitTest();
const sticky = createDevvitTest({ settings: { pinDailyPuzzle: 'sticky' } });
const noPin = createDevvitTest({ settings: { pinDailyPuzzle: 'off' } });
const dailyElo = createDevvitTest({ settings: { guessTheElo: 'daily' } });
const noDaily = createDevvitTest({ settings: { dailyPuzzle: false } });
const eloOff = createDevvitTest({ settings: { guessTheElo: 'off' } });

const ELO = [
  [
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0',
    '600+0',
    '1-0',
    1510,
    1490,
  ],
  ['not chess', '60+0', '1-0', 1000, 1000],
  [
    '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 0-1',
    '180+2',
    '0-1',
    2210,
    2190,
  ],
];

// The Post class is not exported, so reach its prototype through an instance.
const postProto = async () =>
  Object.getPrototypeOf(
    await reddit.submitCustomPost({ subredditName: 'testsub', title: 'seed' })
  );
const spyPins = async () => {
  const proto = await postProto();
  return {
    highlight: vi.spyOn(proto, 'highlight').mockResolvedValue(undefined),
    unhighlight: vi.spyOn(proto, 'unhighlight').mockResolvedValue(undefined),
    sticky: vi.spyOn(proto, 'sticky').mockResolvedValue(undefined),
    unsticky: vi.spyOn(proto, 'unsticky').mockResolvedValue(undefined),
    distinguish: vi.spyOn(proto, 'distinguish').mockResolvedValue(undefined),
  };
};

describe('pinning the daily puzzle', () => {
  test('highlights the new puzzle and unhighlights the previous one', async () => {
    const pins = await spyPins();
    const first = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(pins.highlight).toHaveBeenCalledTimes(1);
    expect(pins.distinguish).toHaveBeenCalledTimes(1);
    expect(pins.unhighlight).not.toHaveBeenCalled();
    await postDailyPuzzle(at('2026-10-30', 13), SET);
    expect(pins.highlight).toHaveBeenCalledTimes(2);
    expect(pins.unhighlight).toHaveBeenCalledTimes(1);
    expect(pins.sticky).not.toHaveBeenCalled();
    if (first.status === 'posted')
      expect(await redis.get(keys.pinned('daily'))).not.toBe(first.postId);
  });

  sticky('sticky mode uses slot 2', async () => {
    const pins = await spyPins();
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    await postDailyPuzzle(at('2026-10-30', 13), SET);
    expect(pins.sticky).toHaveBeenCalledWith(2);
    expect(pins.unsticky).toHaveBeenCalledTimes(1);
    expect(pins.highlight).not.toHaveBeenCalled();
  });

  noPin('off does nothing', async () => {
    const pins = await spyPins();
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(pins.highlight).not.toHaveBeenCalled();
    expect(pins.distinguish).not.toHaveBeenCalled();
  });

  test('pin failures never break posting', async () => {
    const proto = await postProto();
    vi.spyOn(proto, 'highlight').mockRejectedValue(new Error('nope'));
    vi.spyOn(proto, 'distinguish').mockRejectedValue(new Error('nope'));
    const res = await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(res.status).toBe('posted');
  });

  test('uses a matching "Daily Puzzle" flair when the sub has one', async () => {
    await spyPins();
    vi.spyOn(reddit, 'getPostFlairTemplates').mockResolvedValue([
      { id: 'other', text: 'Meme' },
      { id: 'dp', text: ' daily PUZZLE ' },
    ] as unknown as Awaited<ReturnType<typeof reddit.getPostFlairTemplates>>);
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ flairId: 'dp' });
  });

  test('no flair when none matches (or the lookup fails)', async () => {
    await spyPins();
    vi.spyOn(reddit, 'getPostFlairTemplates').mockRejectedValue(new Error('x'));
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('flairId');
  });
});

describe('nextPuzzleAt', () => {
  test('today at the posting hour, else tomorrow once posted', async () => {
    await spyPins();
    expect(await nextPuzzleAt(at('2026-10-29', 9))).toBe(
      at('2026-10-29', 13).getTime()
    );
    // Due but not yet posted: the next hourly run.
    expect(
      await nextPuzzleAt(new Date(at('2026-10-29', 14).getTime() + 5 * 60_000))
    ).toBe(at('2026-10-29', 15).getTime());
    await postDailyPuzzle(at('2026-10-29', 13), SET);
    expect(await nextPuzzleAt(at('2026-10-29', 14))).toBe(
      at('2026-10-30', 13).getTime()
    );
  });

  noDaily('null when daily puzzles are off', async () => {
    expect(await nextPuzzleAt(at('2026-10-29', 9))).toBeNull();
  });

  test('is in the puzzle view', async ({ headers }) => {
    await spyPins();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-29', 13));
      const res = await postDailyPuzzle(new Date(), SET);
      if (res.status !== 'posted') throw new Error('no post');
      const r = await as(headers, { username: 'a', postId: res.postId }, () =>
        call('GET', '/api/init')
      );
      const body = r.json as InitResponse;
      expect(body.post).toMatchObject({
        nextPuzzleAt: at('2026-10-30', 13).getTime(),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Guess the Elo scheduling', () => {
  test('weekly means Saturdays; daily every day; off never', () => {
    expect(eloDue('weekly', '2026-10-31')).toBe(true); // Saturday
    expect(eloDue('weekly', '2026-10-30')).toBe(false);
    expect(eloDue('daily', '2026-10-30')).toBe(true);
    expect(eloDue('off', '2026-10-31')).toBe(false);
  });

  test('posts curated games in order, skipping bad rows, once per date', async ({
    mocks,
  }) => {
    const a = await postEloGame(at('2026-10-31', 13), ELO);
    if (a.status !== 'posted') throw new Error(JSON.stringify(a));
    expect(a.number).toBe(1);
    const post = await reddit.getPostById(a.postId as `t3_${string}`);
    expect(post.title).toBe('Guess the Elo #1');
    expect(mocks.reddit.linksAndComments.getPostData(a.postId)).toMatchObject({
      kind: 'elo',
    });
    const stored = await getPost(a.postId);
    expect(stored).toMatchObject({
      kind: 'elo',
      white: 1510,
      black: 1490,
      source: 'curated',
      author: null,
      game: { timeControl: '600+0', result: '1-0' },
    });
    if (stored?.kind === 'elo') expect(stored.game.pgn).not.toContain('[');

    expect((await postEloGame(at('2026-10-31', 20), ELO)).status).toBe(
      'exists'
    );
    const b = await postEloGame(at('2026-11-07', 13), ELO);
    if (b.status !== 'posted') throw new Error('no post');
    expect(b.number).toBe(2);
    expect(await getPost(b.postId)).toMatchObject({ white: 2210 }); // skipped the bad row
  });

  test('the hourly task posts the weekly game on Saturday only', async () => {
    await spyPins();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-30', 13)); // Friday
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('elo'))).toBeUndefined();
      vi.setSystemTime(at('2026-10-31', 12)); // Saturday, before the hour
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('elo'))).toBeUndefined();
      vi.setSystemTime(at('2026-10-31', 13));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('elo'))).toBe('1');
      expect(await redis.get(keys.latest('daily'))).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });

  dailyElo('daily mode posts every day', async () => {
    await spyPins();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-29', 13));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      vi.setSystemTime(at('2026-10-30', 13));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect(await redis.get(keys.latest('elo'))).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });

  test('the mod menu posts one now, then points at it', async () => {
    const first = await call('POST', '/internal/menu/elo-post', {});
    expect(first.json).toMatchObject({
      showToast: { text: 'Posted Guess the Elo #1' },
    });
    const again = await call('POST', '/internal/menu/elo-post', {});
    expect(again.json).toMatchObject({
      showToast: expect.stringContaining('already up'),
      navigateTo: expect.any(String),
    });
  });
});

describe('deleting a scheduled post', () => {
  test("frees today's date and the pin so the menu can post again", async () => {
    await spyPins();
    const first = await postDailyPuzzle(at('2026-10-29', 13), SET);
    if (first.status !== 'posted') throw new Error('no post');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-10-29', 15));
      await call('POST', '/internal/triggers/on-post-delete', {
        type: 'PostDelete',
        postId: first.postId,
      });
      expect(
        await redis.hGet(keys.dates('daily'), '2026-10-29')
      ).toBeUndefined();
      expect(await redis.get(keys.pinned('daily'))).toBeUndefined();
      const menu = await call('POST', '/internal/menu/daily-post', {});
      expect(menu.json).toMatchObject({
        showToast: { text: 'Posted Daily Puzzle #2' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('leaves the date alone when it points at a newer post', async () => {
    await spyPins();
    const a = await postDailyPuzzle(at('2026-10-29', 13), SET);
    if (a.status !== 'posted') throw new Error('no post');
    await redis.hSet(keys.dates('daily'), { '2026-10-29': 't3_newer' });
    await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: a.postId,
    });
    expect(await redis.hGet(keys.dates('daily'), '2026-10-29')).toBe(
      't3_newer'
    );
  });

  test('frees a curated Guess the Elo date too', async () => {
    const e = await postEloGame(at('2026-10-31', 13), ELO);
    if (e.status !== 'posted') throw new Error('no post');
    await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: e.postId,
    });
    expect(await redis.hGet(keys.dates('elo'), '2026-10-31')).toBeUndefined();
    expect((await postEloGame(at('2026-10-31', 14), ELO)).status).toBe(
      'posted'
    );
  });
});

describe('currentElo in the puzzle view', () => {
  const view = async (h: Record<string, string | undefined>, postId: string) =>
    (
      (await as(h, { username: 'v', postId }, () => call('GET', '/api/init')))
        .json as InitResponse
    ).post;

  test('null until a curated game exists, then the newest one; Elo highlights for a day', async ({
    headers,
  }) => {
    const pins = await spyPins();
    const p = await postDailyPuzzle(at('2026-10-31', 13), SET);
    if (p.status !== 'posted') throw new Error('no post');
    expect(await view(headers, p.postId)).toMatchObject({ currentElo: null });
    await postEloGame(at('2026-10-31', 13), ELO);
    const e2 = await postEloGame(at('2026-11-07', 13), ELO);
    if (e2.status !== 'posted') throw new Error('no post');
    expect(await view(headers, p.postId)).toMatchObject({
      currentElo: { postId: e2.postId, number: 2 },
    });
    // The puzzle, plus each Elo game for its first day (expires by itself).
    expect(pins.highlight).toHaveBeenCalledTimes(3);
    expect(pins.highlight).toHaveBeenLastCalledWith({
      highlightUntil: at('2026-11-08', 13),
    });
    expect(pins.unhighlight).not.toHaveBeenCalled();
    expect(await redis.get(keys.pinned('elo'))).toBeUndefined();
    // Deleting that game clears the link.
    await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: e2.postId,
    });
    expect(await view(headers, p.postId)).toMatchObject({ currentElo: null });
  });

  eloOff('null when Guess the Elo is off', async ({ headers }) => {
    await spyPins();
    await postEloGame(at('2026-10-31', 13), ELO);
    const p = await postDailyPuzzle(at('2026-10-31', 13), SET);
    if (p.status !== 'posted') throw new Error('no post');
    expect(await view(headers, p.postId)).toMatchObject({ currentElo: null });
  });
});

describe('Guess the Elo highlight in other modes', () => {
  sticky('sticky mode never pins Guess the Elo', async () => {
    const pins = await spyPins();
    await postEloGame(at('2026-10-31', 13), ELO);
    expect(pins.highlight).not.toHaveBeenCalled();
    expect(pins.sticky).not.toHaveBeenCalled();
  });

  noPin('off never pins Guess the Elo', async () => {
    const pins = await spyPins();
    await postEloGame(at('2026-10-31', 13), ELO);
    expect(pins.highlight).not.toHaveBeenCalled();
  });

  test('a highlight failure never breaks posting', async () => {
    const proto = await postProto();
    vi.spyOn(proto, 'highlight').mockRejectedValue(new Error('full'));
    expect((await postEloGame(at('2026-10-31', 13), ELO)).status).toBe(
      'posted'
    );
  });
});
