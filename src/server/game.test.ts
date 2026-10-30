import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type { GameVoteResponse, InitResponse } from '../shared/api';
import {
  advanceGame,
  castGameVote,
  endGame,
  forgetGamePost,
  readState,
  startGame,
} from './core/game';
import { getPost, keys } from './core/store';
import { accountsExist, as, asMod, at, call } from './test-utils';

const test = createDevvitTest({ settings: { pinDailyPuzzle: 'off' } });
const noHighlight = createDevvitTest({
  settings: { pinDailyPuzzle: 'off', highlightGame: false },
});
type Headers = Record<string, string | undefined>;

const vote = (h: Headers, u: string | null, postId: string, move: string) =>
  as(h, { username: u, postId }, () =>
    call('POST', '/api/game/vote', { move })
  );
const view = async (h: Headers, u: string | null, postId: string) =>
  (
    (await as(h, { username: u, postId }, () => call('GET', '/api/init')))
      .json as InitResponse
  ).post;
const started = async (now = at('2026-11-01', 9)) => {
  const r = await startGame(now);
  if (!r.ok) throw new Error(r.error);
  return r.postId;
};
const day = (n: number, hour = 13) =>
  at(`2026-11-${String(n).padStart(2, '0')}`, hour);
/** Advance one day with these votes (user -> move) on the open post. */
const playDay = async (
  h: Headers,
  n: number,
  votes: Record<string, string>
) => {
  const s = await readState();
  if (!s?.openPostId) throw new Error('no open post');
  for (const [u, m] of Object.entries(votes)) await vote(h, u, s.openPostId, m);
  return advanceGame(day(n));
};

describe('starting and ending', () => {
  test('mods start a game: move 1 goes up at once as the app', async ({
    headers,
    mocks,
  }) => {
    asMod();
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    const r = await call('POST', '/internal/form/game-start', {});
    expect(r.json).toMatchObject({
      showToast: { text: 'Community game started.' },
    });
    const args = submit.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      title: 'r/testsub community game · Move 1 · White to play',
    });
    expect(args).not.toHaveProperty('runAs');
    expect(args).toMatchObject({
      textFallback: { text: expect.stringContaining('FEN:') },
    });
    const s = await readState();
    expect(s).toMatchObject({ version: 1, gameNumber: 1, moves: [] });
    const postId = s?.openPostId ?? '';
    expect(mocks.reddit.linksAndComments.getPostData(postId)).toMatchObject({
      kind: 'game',
      orientation: 'white',
      card: { kind: 'game', gameNumber: 1, moveNumber: 1 },
    });
    expect(await view(headers, 'a', postId)).toMatchObject({
      kind: 'game',
      gameNumber: 1,
      moveNumber: 1,
      turn: 'white',
      status: 'open',
      results: null,
      lastMove: null,
      moves: [],
    });
  });

  test('only mods can start or end, and only one game at a time', async () => {
    const msg = { showToast: 'Only moderators can do that.' };
    expect((await call('POST', '/internal/form/game-start', {})).json).toEqual(
      msg
    );
    expect((await call('POST', '/internal/form/game-end', {})).json).toEqual(
      msg
    );
    asMod();
    await call('POST', '/internal/form/game-start', {});
    expect((await call('POST', '/internal/form/game-start', {})).json).toEqual({
      showToast: 'A community game is already running.',
    });
    expect(
      (await call('POST', '/internal/menu/game-start', {})).json
    ).toMatchObject({
      showToast: 'A community game is already running.',
      navigateTo: expect.any(String),
    });
    expect(
      (await call('POST', '/internal/menu/game-end', {})).json
    ).toMatchObject({
      showForm: { name: 'gameEndForm' },
    });
  });

  test('ending stops voting and posts nothing; a new game can start, numbered #2', async ({
    headers,
  }) => {
    const first = await started();
    expect(await endGame()).toBe(true);
    expect(await view(headers, 'a', first)).toMatchObject({
      status: 'ended',
      results: [],
    });
    expect((await vote(headers, 'a', first, 'e2e4')).status).toBe(409);
    expect((await advanceGame(day(2))).status).toBe('none');
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await started(day(2, 15));
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      title: 'r/testsub community game #2 · Move 1 · White to play',
    });
    expect(await endGame()).toBe(true);
    expect(await endGame()).toBe(false);
  });
});

describe('voting', () => {
  test('logged-in legal votes, one per user; results after voting', async ({
    headers,
  }) => {
    const id = await started();
    expect((await vote(headers, null, id, 'e2e4')).status).toBe(401);
    expect((await vote(headers, 'a', id, 'e7e5')).status).toBe(400);
    const r = await vote(headers, 'a', id, 'e2e4');
    expect(r.json as GameVoteResponse).toEqual({
      type: 'gameVote',
      myVote: 'e2e4',
      totalVotes: 1,
      results: [{ move: 'e2e4', san: 'e4', votes: 1 }],
    });
    expect((await vote(headers, 'a', id, 'd2d4')).status).toBe(409);
    expect(await view(headers, 'b', id)).toMatchObject({
      results: null,
      totalVotes: 1,
    });
    expect(await view(headers, 'a', id)).toMatchObject({
      myVote: 'e2e4',
      results: [{ votes: 1 }],
    });
  });
});

describe('daily close and advance', () => {
  test('the winner is played, the old post closes with a link, the next post goes up', async ({
    headers,
  }) => {
    const id = await started();
    const r = await playDay(headers, 2, { a: 'e2e4', b: 'e2e4', c: 'd2d4' });
    if (r.status !== 'posted') throw new Error(JSON.stringify(r));
    expect(await view(headers, 'x', id)).toMatchObject({
      status: 'closed',
      winningMove: { move: 'e2e4', san: 'e4' },
      nextPostId: r.postId,
      results: [
        { move: 'e2e4', votes: 2 },
        { move: 'd2d4', votes: 1 },
      ],
    });
    expect((await vote(headers, 'd', id, 'g1f3')).status).toBe(409);
    expect((await reddit.getPostById(r.postId as `t3_${string}`)).title).toBe(
      'r/testsub community game · Move 1 · Black to play'
    );
    expect(await view(headers, 'x', r.postId)).toMatchObject({
      status: 'open',
      turn: 'black',
      moveNumber: 1,
      lastMove: 'e2e4',
      moves: ['e2e4'],
    });
  });

  test('a tie goes to the move that reached that count first', async ({
    headers,
  }) => {
    await started();
    // d4 reaches 2 votes before e4 does.
    const r = await playDay(headers, 2, {
      a: 'e2e4',
      b: 'd2d4',
      c: 'd2d4',
      d: 'e2e4',
    });
    if (r.status !== 'posted') throw new Error('no post');
    expect((await readState())?.moves).toEqual(['d2d4']);
  });

  test('no votes: nothing posted that day and the same post stays open', async ({
    headers,
  }) => {
    const id = await started();
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    expect((await advanceGame(day(2))).status).toBe('novotes');
    expect((await advanceGame(day(2, 20))).status).toBe('none'); // later the same day
    expect(submit).not.toHaveBeenCalled();
    expect(await view(headers, 'a', id)).toMatchObject({ status: 'open' });
    await vote(headers, 'a', id, 'e2e4');
    expect((await advanceGame(day(3))).status).toBe('posted');
  });

  test('never two posts in a day, even with overlapping runs', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => advanceGame(day(2)))
    );
    expect(runs.filter((r) => r.status === 'posted')).toHaveLength(1);
    expect((await readState())?.moves).toEqual(['e2e4']);
  });

  test('the start day counts as posted: the first advance is the next day', async ({
    headers,
  }) => {
    const id = await started(day(1, 9));
    await vote(headers, 'a', id, 'e2e4');
    expect((await advanceGame(day(1, 13))).status).toBe('none');
    expect((await advanceGame(day(2, 13))).status).toBe('posted');
  });

  test('the hourly task advances at the posting hour', async ({ headers }) => {
    accountsExist();
    const id = await started(day(1, 9));
    await vote(headers, 'a', id, 'e2e4');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(day(2, 12));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect((await readState())?.moves).toEqual([]);
      vi.setSystemTime(day(2, 13));
      await call('POST', '/internal/scheduler/daily-puzzle', {});
      expect((await readState())?.moves).toEqual(['e2e4']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a failed post changes nothing and can be retried the same day', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    vi.spyOn(reddit, 'submitCustomPost').mockRejectedValueOnce(
      new Error('down')
    );
    expect((await advanceGame(day(2))).status).toBe('error');
    expect(await view(headers, 'a', id)).toMatchObject({ status: 'open' });
    expect((await advanceGame(day(2, 14))).status).toBe('posted');
  });
});

describe('game end', () => {
  test("checkmate: the next post is a review post of the whole game; then it's over", async ({
    headers,
  }) => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    await started();
    const line = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    let last;
    for (const [i, m] of line.entries())
      last = await playDay(headers, i + 2, { a: m });
    if (last?.status !== 'posted') throw new Error('no post');
    expect(last.over).toBe(true);
    expect(
      (await reddit.getPostById(last.postId as `t3_${string}`)).title
    ).toBe('r/testsub community game · Black wins by checkmate in 2');
    expect(await getPost(last.postId)).toMatchObject({
      kind: 'review',
      white: 'r/testsub',
      black: 'r/testsub',
      result: '0-1',
      author: null,
      caption: 'Black wins by checkmate in 2.',
    });
    const review = await view(headers, 'a', last.postId);
    expect(review).toMatchObject({ kind: 'review', analysis: null });
    if (review.kind === 'review') expect(review.pgn).toContain('Qh4#');
    expect(await readState()).toMatchObject({ openPostId: null, moves: line });
    expect(submit.mock.calls[4]?.[0].postData).toMatchObject({
      kind: 'review',
      card: {
        kind: 'review',
        white: 'r/testsub',
        black: 'r/testsub',
        result: '0-1',
        caption: 'Black wins by checkmate in 2.',
        game: 1,
      },
    });
    expect(submit.mock.calls[3]?.[0].postData).toMatchObject({
      card: { kind: 'game', gameNumber: 1, moveNumber: 2 },
    });
    // Move posts and the result post all get the community game's card.
    expect(submit).toHaveBeenCalledTimes(5);
    for (const [opts] of submit.mock.calls)
      expect(opts.styles).toEqual({ heightPixels: 512 });
    expect((await advanceGame(day(9))).status).toBe('none');
    // A new game can start.
    asMod();
    expect(
      (await call('POST', '/internal/form/game-start', {})).json
    ).toMatchObject({
      showToast: { text: 'Community game started.' },
    });
  });

  test('threefold repetition ends it as a draw', async ({ headers }) => {
    await started();
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    let last;
    for (const [i, m] of [...shuffle, ...shuffle].entries())
      last = await playDay(headers, i + 2, { a: m });
    if (last?.status !== 'posted' || !last.over) throw new Error('not over');
    expect(
      (await reddit.getPostById(last.postId as `t3_${string}`)).title
    ).toBe('r/testsub community game · Draw by threefold repetition in 4');
  });
});

describe('cleanup and upgrade safety', () => {
  test('deleting the open post ends the game and removes its data', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: id,
    });
    expect(await readState()).toMatchObject({ openPostId: null });
    for (const k of [
      keys.post(id),
      keys.votes(id),
      keys.counts(id),
      keys.gameSeq(id),
    ])
      expect(await redis.exists(k)).toBe(0);
  });

  test('unknown or corrupt state reads as no game', async () => {
    await redis.set(
      keys.gameState,
      JSON.stringify({ version: 99, openPostId: 't3_x' })
    );
    expect(await readState()).toBeNull();
    await redis.set(keys.gameState, 'not json');
    expect(await readState()).toBeNull();
    expect((await advanceGame(day(2))).status).toBe('none');
  });
});

describe('crash and race safety (review fixes)', () => {
  test('a crash before the old post is marked closed heals on the next run', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    // Every write of the old post's record fails during this advance.
    const realSet = redis.set.bind(redis);
    const spy = vi.spyOn(redis, 'set').mockImplementation(async (k, v, o) => {
      if (k === keys.post(id) && v.includes('"closed"'))
        throw new Error('crash');
      return realSet(k, v, o);
    });
    const r = await advanceGame(day(2));
    if (r.status !== 'posted') throw new Error(JSON.stringify(r));
    spy.mockRestore();
    expect(await readState()).toMatchObject({
      openPostId: r.postId,
      prev: { postId: id },
    });
    // The next run (or any later one) finishes closing it.
    await advanceGame(day(3));
    expect(await view(headers, 'x', id)).toMatchObject({
      status: 'closed',
      winningMove: { move: 'e2e4' },
      nextPostId: r.postId,
    });
    expect(await readState()).toMatchObject({ prev: null });
  });

  test('a lost record for the new post is rebuilt, so it never 404s', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    const r = await advanceGame(day(2));
    if (r.status !== 'posted') throw new Error('no post');
    await redis.del(keys.post(r.postId)); // as if the record write had failed
    expect(await view(headers, 'x', r.postId)).toMatchObject({
      kind: 'game',
      status: 'open',
      moves: ['e2e4'],
    });
    expect((await vote(headers, 'b', r.postId, 'e7e5')).status).toBe(200);
  });

  test('old ordering: an open post already closed with a successor moves the state on', async ({
    headers,
  }) => {
    const id = await started();
    const post = await getPost(id);
    if (post?.kind !== 'game') throw new Error('no post');
    await redis.set(
      keys.post(id),
      JSON.stringify({
        ...post,
        status: 'closed',
        winningMove: 'e2e4',
        nextPostId: 't3_next',
      })
    );
    await advanceGame(day(2));
    expect(await readState()).toMatchObject({
      moves: ['e2e4'],
      openPostId: 't3_next',
    });
    expect(await view(headers, 'x', 't3_next')).toMatchObject({
      status: 'open',
      turn: 'black',
    });
  });

  test('End during a run is not undone: the new post is ended, no move is played', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    const real = reddit.submitCustomPost.bind(reddit);
    vi.spyOn(reddit, 'submitCustomPost').mockImplementation(async (o) => {
      await endGame(); // a mod ends the game while we post
      return real(o);
    });
    const r = await advanceGame(day(2));
    expect(r.status).toBe('none');
    expect(await readState()).toMatchObject({ openPostId: null, moves: [] });
    expect(await view(headers, 'x', id)).toMatchObject({ status: 'ended' });
    const newId =
      Object.values(await redis.hGetAll(keys.dates('game'))).find(
        (v) => v !== id
      ) ?? '';
    expect(newId).not.toBe('');
    expect(await view(headers, 'x', newId)).toMatchObject({ status: 'ended' });
    expect((await vote(headers, 'b', newId, 'e7e5')).status).toBe(409);
  });

  test('deleting the open post during a run is not undone either', async ({
    headers,
  }) => {
    const id = await started();
    await vote(headers, 'a', id, 'e2e4');
    const real = reddit.submitCustomPost.bind(reddit);
    vi.spyOn(reddit, 'submitCustomPost').mockImplementation(async (o) => {
      await forgetGamePost(id);
      return real(o);
    });
    expect((await advanceGame(day(2))).status).toBe('none');
    expect(await readState()).toMatchObject({ openPostId: null });
  });

  test('two Starts at once make one game', async () => {
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    const rs = await Promise.all([
      startGame(day(1)),
      startGame(day(1)),
      startGame(day(1)),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await readState()).toMatchObject({ gameNumber: 1 });
  });

  test('a vote that lands during the tally is refused, not silently dropped', async () => {
    const id = await started();
    const post = await getPost(id);
    if (post?.kind !== 'game') throw new Error('no post');
    await redis.set(
      keys.post(id),
      JSON.stringify({ ...post, status: 'closing' })
    );
    // The request saw the post while it was still open.
    const r = await castGameVote('late', id, post, 'e2e4');
    expect(r).toEqual({
      ok: false,
      status: 409,
      message: 'Voting on this move has closed.',
    });
    expect(await redis.hGet(keys.votes(id), 'late')).toBeUndefined();
  });

  test('ties are decided from the stored vote order, exactly', async ({
    headers,
  }) => {
    const id = await started();
    await Promise.all(
      ['e2e4', 'd2d4', 'd2d4', 'e2e4'].map((m, i) =>
        vote(headers, `u${i}`, id, m)
      )
    );
    const stored = Object.values(await redis.hGetAll(keys.votes(id))).map((v) =>
      v.split('@')
    );
    const second = (m: string) =>
      stored
        .filter(([mv]) => mv === m)
        .map(([, n]) => Number(n))
        .sort((a, b) => a - b)[1] ?? Infinity;
    const expected = second('e2e4') < second('d2d4') ? 'e2e4' : 'd2d4';
    await advanceGame(day(2));
    expect((await readState())?.moves).toEqual([expected]);
    expect(await view(headers, 'x', id)).toMatchObject({
      results: [{ votes: 2 }, { votes: 2 }],
    });
  });
});

describe('highlighting game posts', () => {
  // The Post class is not exported, so reach its prototype through an instance.
  const spyHighlights = async () => {
    const proto = Object.getPrototypeOf(
      await reddit.submitCustomPost({ subredditName: 'testsub', title: 'seed' })
    );
    return {
      highlight: vi.spyOn(proto, 'highlight').mockResolvedValue(undefined),
      unhighlight: vi.spyOn(proto, 'unhighlight').mockResolvedValue(undefined),
    };
  };

  test('each new game post is highlighted until just after the next post; the previous one is dropped', async ({
    headers,
  }) => {
    const spies = await spyHighlights();
    const id = await started(day(1, 9));
    expect(spies.highlight).toHaveBeenLastCalledWith({
      highlightUntil: day(1, 15),
    }); // 13:00 + 2 h
    await vote(headers, 'a', id, 'e2e4');
    await advanceGame(day(2, 13));
    expect(spies.unhighlight).toHaveBeenCalledTimes(1);
    expect(spies.highlight).toHaveBeenLastCalledWith({
      highlightUntil: day(3, 15),
    });
  });

  test('a day with no votes keeps the open post highlighted another day', async () => {
    const spies = await spyHighlights();
    await started(day(1, 9));
    await advanceGame(day(2, 13));
    expect(spies.highlight).toHaveBeenLastCalledWith({
      highlightUntil: day(3, 15),
    });
    expect(spies.unhighlight).not.toHaveBeenCalled();
  });

  test('highlight failures never block the game', async ({ headers }) => {
    const proto = Object.getPrototypeOf(
      await reddit.submitCustomPost({ subredditName: 'testsub', title: 'seed' })
    );
    vi.spyOn(proto, 'highlight').mockRejectedValue(new Error('full'));
    vi.spyOn(proto, 'unhighlight').mockRejectedValue(new Error('nope'));
    const id = await started(day(1, 9));
    await vote(headers, 'a', id, 'e2e4');
    expect((await advanceGame(day(2, 13))).status).toBe('posted');
  });

  noHighlight('the setting turns it off', async ({ headers }) => {
    const spies = await spyHighlights();
    const id = await started(day(1, 9));
    await vote(headers, 'a', id, 'e2e4');
    await advanceGame(day(2, 13));
    expect(spies.highlight).not.toHaveBeenCalled();
    expect(spies.unhighlight).not.toHaveBeenCalled();
  });
});
