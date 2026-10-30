import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type {
  InitResponse,
  PollCreateResponse,
  PollVoteResponse,
} from '../shared/api';
import { postDailyPuzzle } from './core/daily';
import { createPollPost } from './core/posts';
import { getPost } from './core/store';
import { SET, as, asMod, at, call, stubUserActions } from './test-utils';

const test = createDevvitTest({ settings: { pinDailyPuzzle: 'off' } });
const closed = createDevvitTest({ settings: { memberPosts: false } });

type Headers = Record<string, string | undefined>;

const postPuzzle = async (day: number): Promise<string> => {
  const date = `2026-11-${String(day).padStart(2, '0')}`;
  const res = await postDailyPuzzle(at(date, 13), SET);
  if (res.status !== 'posted') throw new Error(JSON.stringify(res));
  return res.postId;
};

const ok = <T>(r: { status: number; json: unknown }): T => {
  expect(r.status).toBe(200);
  // The route's own response type, asserted by the status check above.
  return JSON.parse(JSON.stringify(r.json));
};

describe('polls', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const makePoll = async (closeHours = 0, now?: Date) => {
    const res = await createPollPost(
      {
        position: START,
        prompt: 'Best opener?',
        closeHours,
        orientation: 'auto',
      },
      now
    );
    if (!res.ok) throw new Error(res.error);
    return res.postId;
  };
  const view = (h: Headers, username: string | null, postId: string) =>
    as(h, { username, postId }, () => call('GET', '/api/init')).then((r) =>
      ok<InitResponse>(r)
    );
  const vote = (
    h: Headers,
    username: string | null,
    postId: string,
    move: string
  ) =>
    as(h, { username, postId }, () => call('POST', '/api/poll/vote', { move }));

  test('hides results until the viewer votes, then shows SAN sorted by votes', async ({
    headers,
  }) => {
    const postId = await makePoll();
    const before = await view(headers, 'p1', postId);
    expect(before.post).toMatchObject({
      kind: 'poll',
      prompt: 'Best opener?',
      myVote: null,
      results: null,
      totalVotes: 0,
      closesAt: null,
    });

    const first = ok<PollVoteResponse>(
      await vote(headers, 'p1', postId, 'e2e4')
    );
    expect(first.results).toEqual([{ move: 'e2e4', san: 'e4', votes: 1 }]);
    await vote(headers, 'p2', postId, 'd2d4');
    await vote(headers, 'p3', postId, 'd2d4');

    const after = await view(headers, 'p1', postId);
    expect(after.post).toMatchObject({
      myVote: 'e2e4',
      totalVotes: 3,
      results: [
        { move: 'd2d4', san: 'd4', votes: 2 },
        { move: 'e2e4', san: 'e4', votes: 1 },
      ],
    });
    // Someone who has not voted still sees nothing.
    expect((await view(headers, 'lurker', postId)).post).toMatchObject({
      results: null,
      totalVotes: 3,
    });
    expect((await view(headers, null, postId)).post).toMatchObject({
      results: null,
      myVote: null,
    });
  });

  test('illegal and malformed moves are rejected', async ({ headers }) => {
    const postId = await makePoll();
    expect((await vote(headers, 'p1', postId, 'e2e5')).status).toBe(400);
    expect((await vote(headers, 'p1', postId, 'e7e5')).status).toBe(400);
    expect((await vote(headers, 'p1', postId, 'zzz')).status).toBe(400);
    const bad = await as(headers, { username: 'p1', postId }, () =>
      call('POST', '/api/poll/vote', { move: 5 })
    );
    expect(bad.status).toBe(400);
    // A rejected move does not use up the vote.
    expect((await vote(headers, 'p1', postId, 'e2e4')).status).toBe(200);
  });

  test('one final vote per user, even when sent simultaneously', async ({
    headers,
  }) => {
    const postId = await makePoll();
    const rs = await Promise.all(
      ['e2e4', 'd2d4', 'e2e4', 'c2c4', 'g1f3'].map((m) =>
        vote(headers, 'dup', postId, m)
      )
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    const after = await view(headers, 'dup', postId);
    expect(after.post).toMatchObject({ totalVotes: 1 });

    const changed = await vote(headers, 'dup', postId, 'c2c4');
    expect(changed.status).toBe(409);
    expect((await view(headers, 'dup', postId)).post).toMatchObject({
      totalVotes: 1,
    });
  });

  test('logged-out votes are rejected with 401', async ({ headers }) => {
    const postId = await makePoll();
    const r = await vote(headers, null, postId, 'e2e4');
    expect(r.status).toBe(401);
    expect((await view(headers, 'p1', postId)).post).toMatchObject({
      totalVotes: 0,
    });
  });

  test('a closed poll rejects votes and reveals results to everyone', async ({
    headers,
  }) => {
    const postId = await makePoll(1, new Date(Date.now() - 2 * 3_600_000)); // closed an hour ago
    expect((await vote(headers, 'p1', postId, 'e2e4')).status).toBe(409);
    const closed = await view(headers, 'p1', postId);
    expect(closed.post).toMatchObject({ results: [], totalVotes: 0 });
  });

  test('the mod menu closes an open poll, keeping earlier votes', async ({
    headers,
  }) => {
    const postId = await makePoll();
    await vote(headers, 'p1', postId, 'e2e4');
    const r = await as(headers, { username: 'mod', postId }, () =>
      call('POST', '/internal/menu/poll-close', {})
    );
    expect(r.json).toMatchObject({ showToast: { appearance: 'success' } });
    expect((await vote(headers, 'p2', postId, 'd2d4')).status).toBe(409);
    const v = await view(headers, 'lurker', postId);
    expect(v.post).toMatchObject({
      totalVotes: 1,
      results: [{ move: 'e2e4', san: 'e4', votes: 1 }],
    });
    if (v.post.kind === 'poll') expect(v.post.closesAt).not.toBeNull();
  });

  test('poll-close on a non-poll post only toasts', async ({ headers }) => {
    const postId = await postPuzzle(1);
    const r = await as(headers, { username: 'mod', postId }, () =>
      call('POST', '/internal/menu/poll-close', {})
    );
    expect(r.json).toEqual({ showToast: 'This is not a poll.' });
  });
});

describe('POST /api/poll/create', () => {
  const create = (h: Headers, user: string | null, body: unknown) =>
    as(h, { username: user }, () => call('POST', '/api/poll/create', body));
  const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const good = { fen: FEN, prompt: '', closeHours: 24 };

  test('members can create, posting as themselves; logged-out is 401', async ({
    headers,
  }) => {
    const submit = stubUserActions();
    expect((await create(headers, null, good)).status).toBe(401);
    const r = ok<PollCreateResponse>(await create(headers, 'member', good));
    expect(r).toMatchObject({
      type: 'pollCreate',
      url: expect.stringContaining('/comments/'),
    });
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      runAs: 'USER',
      title: "What's the move? · Black to play",
      textFallback: { text: expect.stringContaining(FEN) },
      postData: { card: { kind: 'poll', prompt: 'Black to play' } },
    });
    expect(await getPost(r.postId)).toMatchObject({ prompt: 'Black to play' });
  });

  test('a custom prompt leads the title; the explicit last move is kept', async ({
    headers,
  }) => {
    const submit = stubUserActions();
    const r = ok<PollCreateResponse>(
      await create(headers, 'm', {
        ...good,
        prompt: 'Best reply?',
        lastMove: 'e2e4',
      })
    );
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Best reply? · Black to play',
    });
    expect(await getPost(r.postId)).toMatchObject({
      prompt: 'Best reply?',
      lastMove: 'e2e4',
    });
  });

  test("the form's default prompt isn't repeated in the title", async ({
    headers,
  }) => {
    const submit = stubUserActions();
    for (const [i, prompt] of [
      'Black to play',
      'black to play.',
      'Black to move: mate in 2',
    ].entries())
      ok(await create(headers, `m${i}`, { ...good, prompt }));
    expect(submit.mock.calls.map((c) => c[0].title)).toEqual([
      "What's the move? · Black to play",
      "What's the move? · Black to play",
      'Black to move: mate in 2',
    ]);
  });

  test('validates every field with plain messages', async ({ headers }) => {
    stubUserActions();
    const bad = async (patch: Record<string, unknown>) =>
      (await create(headers, 'm', { ...good, ...patch })).json as {
        message?: string;
      };
    expect((await bad({ fen: '' })).message).toContain('Enter a FEN');
    expect((await bad({ fen: 'nonsense' })).message).toContain("isn't a FEN");
    expect(
      (await bad({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' })).message
    ).toContain('game is over');
    expect((await bad({ prompt: 'x'.repeat(201) })).message).toContain('200');
    expect((await bad({ closeHours: 169 })).message).toContain('168');
    expect((await bad({ closeHours: -1 })).message).toContain('168');
    for (const patch of [
      { fen: 5 },
      { prompt: 7 },
      { closeHours: 'soon' },
      { lastMove: 4 },
    ])
      expect((await create(headers, 'm', { ...good, ...patch })).status).toBe(
        400
      );
    expect((await bad({ lastMove: 'e2e2' })).message).toBe(
      'Something went wrong. Try again.'
    );
    const fine = await create(headers, 'm', {
      ...good,
      prompt: 'x'.repeat(200),
      closeHours: 168,
    });
    expect(fine.status).toBe(200);
  });

  closed(
    'members cannot post when the sub turns member posts off; mods can',
    async ({ headers }) => {
      stubUserActions();
      const r = await create(headers, 'member', good);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({
        message: 'Member posts are off in this community.',
      });
      asMod();
      expect((await create(headers, 'mod', good)).status).toBe(200);
    }
  );
});

describe('member posting quota and create options', () => {
  const init = async (h: Headers, u: string | null, postId: string) =>
    ok<InitResponse>(
      await as(h, { username: u, postId }, () => call('GET', '/api/init'))
    );
  const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const poll = (h: Headers, u: string, body: Record<string, unknown> = {}) =>
    as(h, { username: u }, () =>
      call('POST', '/api/poll/create', {
        fen: FEN,
        prompt: '',
        closeHours: 0,
        ...body,
      })
    );

  test('5 posts a day per member; failures do not count; options reflect it', async ({
    headers,
  }) => {
    stubUserActions();
    const postId = await postPuzzle(1);
    expect((await init(headers, null, postId)).create).toEqual({
      review: false,
      elo: false,
      poll: false,
      remainingToday: 0,
    });
    expect((await init(headers, 'mem', postId)).create).toEqual({
      review: true,
      elo: true,
      poll: true,
      remainingToday: 5,
    });
    for (let i = 0; i < 3; i++) await poll(headers, 'mem', { fen: 'junk' }); // failures
    for (let i = 0; i < 5; i++)
      expect((await poll(headers, 'mem')).status).toBe(200);
    const sixth = await poll(headers, 'mem');
    expect(sixth.json).toMatchObject({
      message: expect.stringContaining('5 posts a day'),
    });
    expect((await init(headers, 'mem', postId)).create).toMatchObject({
      poll: false,
      remainingToday: 0,
    });
    expect((await init(headers, 'other', postId)).create.remainingToday).toBe(
      5
    );
  });

  test('a post Reddit rejects does not use up the quota', async ({
    headers,
  }) => {
    const spy = stubUserActions();
    for (let i = 0; i < 6; i++) {
      spy.mockRejectedValueOnce(new Error('banned from r/testsub'));
      const r = await poll(headers, 'mem');
      expect(r.json).toMatchObject({
        message: "Reddit didn't accept the post. Try again later.",
      });
    }
    expect((await poll(headers, 'mem')).status).toBe(200);
  });

  test('mods are unlimited and see 99', async ({ headers }) => {
    stubUserActions();
    asMod();
    const postId = await postPuzzle(1);
    for (let i = 0; i < 7; i++)
      expect((await poll(headers, 'mod')).status).toBe(200);
    expect((await init(headers, 'mod', postId)).create).toMatchObject({
      remainingToday: 99,
    });
  });

  closed(
    'options are all off for members when member posts are off',
    async ({ headers }) => {
      const postId = await postPuzzle(1);
      expect((await init(headers, 'mem', postId)).create).toEqual({
        review: false,
        elo: false,
        poll: false,
        remainingToday: 0,
      });
    }
  );

  test('init reports canModerate', async ({ headers }) => {
    const postId = await postPuzzle(1);
    expect((await init(headers, 'rando', postId)).canModerate).toBe(false);
    asMod();
    expect((await init(headers, 'mod', postId)).canModerate).toBe(true);
    expect((await init(headers, null, postId)).canModerate).toBe(false);
  });
});

describe('errors', () => {
  test('init on a missing or retired post is a clean 404', async ({
    headers,
  }) => {
    await redis.set(
      'post:t3_old',
      JSON.stringify({ kind: 'analysis', fen: 'x' })
    );
    for (const postId of ['t3_old', 't3_none']) {
      const r = await as(headers, { username: 'a', postId }, () =>
        call('GET', '/api/init')
      );
      expect(r.status).toBe(404);
      expect(r.json).toEqual({
        type: 'error',
        message: 'This post is no longer available.',
      });
    }
  });

  test('unexpected failures never leak developer text', async ({ headers }) => {
    const postId = await postPuzzle(1);
    vi.spyOn(redis, 'hGet').mockRejectedValue(
      new Error('ECONNRESET at redis.internal:1234')
    );
    const r = await as(headers, { username: 'a', postId }, () =>
      call('GET', '/api/init')
    );
    expect(r.status).toBe(500);
    expect(r.json).toEqual({
      type: 'error',
      message: 'Something went wrong. Try again.',
    });
  });
});
