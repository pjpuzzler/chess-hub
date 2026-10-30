import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { Chess } from 'chess.js';
import { describe, expect, vi } from 'vitest';
import type { InitResponse, ReviewAnalysis } from '../shared/api';
import { parseGame } from '../shared/chess/review';
import { lichessGameId } from './core/lichess';
import { createReviewPost } from './core/posts';
import { stubUserActions, as, asMod, call } from './test-utils';

const test = createDevvitTest();
const locked = createDevvitTest({ settings: { memberPosts: false } });

type Headers = Record<string, string | undefined>;

const PGN =
  '[White "Ann"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';

const makeReview = async (pgn = PGN, user = 'testuser') => {
  stubUserActions();
  const res = await createReviewPost({ pgnOrUrl: pgn, caption: 'hi' }, user);
  if (!res.ok) throw new Error(res.error);
  return res.postId;
};

test('the post carries its feed card text, cut to fit postData', async () => {
  const submit = stubUserActions();
  const long = 'é'.repeat(400);
  const res = await createReviewPost(
    { pgnOrUrl: PGN.replace('Ann', 'A'.repeat(200)), caption: long },
    'testuser'
  );
  expect(res.ok).toBe(true);
  const data = submit.mock.calls[0]?.[0].postData;
  expect(data).toMatchObject({
    kind: 'review',
    card: {
      kind: 'review',
      white: 'A'.repeat(40),
      black: 'Bob',
      result: '1-0',
      caption: 'é'.repeat(140),
      game: null,
    },
  });
  expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThan(
    2048
  );
});

const analysisFor = (pgn = PGN): ReviewAnalysis => {
  const g = parseGame(pgn);
  if ('error' in g) throw new Error(g.error);
  return {
    engine: 'Stockfish 19 lite',
    depth: 12,
    positions: g.fens.map((fen) => ({
      score: { cp: 15 },
      best:
        new Chess(fen)
          .moves({ verbose: true })
          .map((m) => `${m.from}${m.to}`)[0] ?? null,
    })),
  };
};

const submit = (
  h: Headers,
  user: string | null,
  postId: string,
  body: unknown
) =>
  as(h, { username: user, postId }, () =>
    call('POST', '/api/review/analysis', body)
  );
const init = (h: Headers, user: string | null, postId: string) =>
  as(h, { username: user, postId }, () => call('GET', '/api/init')).then(
    (r) => JSON.parse(JSON.stringify(r.json)) as InitResponse
  );

describe('creating reviews', () => {
  const create = (h: Headers, u: string | null, body: unknown) =>
    as(h, { username: u }, () => call('POST', '/api/review/create', body));

  test('posts as the user with a default title and stores the normalised game', async ({
    headers,
  }) => {
    const submitSpy = stubUserActions();
    const r = await create(headers, 'ann', {
      pgnOrUrl:
        '[White "Ann"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 {note} e5 (1... c5) 2. Nf3 1-0',
      caption: ' nice ',
    });
    expect(r.status).toBe(200);
    const { postId } = r.json as { postId: string };
    expect(submitSpy.mock.calls[0]?.[0]).toMatchObject({
      runAs: 'USER',
      title: 'Game review: Ann vs Bob (1-0)',
      textFallback: { text: 'Game review: Ann vs Bob (1-0). nice' },
    });
    expect((await init(headers, 'viewer', postId)).post).toMatchObject({
      kind: 'review',
      white: 'Ann',
      black: 'Bob',
      result: '1-0',
      caption: 'nice',
      author: 'ann',
      analysis: null,
    });
  });

  test('caps and cleans user text from PGN headers and captions', async ({
    headers,
  }) => {
    stubUserActions();
    const long = 'N'.repeat(500);
    const r = await create(headers, 'ann', {
      pgnOrUrl: `[White "${long}"]\n[Black "<b>x</b>"]\n[Result "bogus"]\n\n1. e4 e5 *`,
      caption: 'c'.repeat(900),
    });
    const { postId } = r.json as { postId: string };
    const view = (await init(headers, 'v', postId)).post;
    if (view.kind !== 'review') throw new Error('not a review');
    expect(view.white).toHaveLength(60);
    expect(view.black).toBe('<b>x</b>'); // stored as plain text, never markup
    expect(view.result).toBe('*');
    expect(view.caption).toHaveLength(500);
    expect(view.pgn.length).toBeLessThan(400);
  });

  test('rejects bad PGNs and games over 300 plies with clear messages', async ({
    headers,
  }) => {
    stubUserActions();
    expect(
      (await create(headers, 'a', { pgnOrUrl: 'nope', caption: '' })).json
    ).toMatchObject({
      message: "That doesn't look like a valid PGN.",
    });
    const c = new Chess();
    const cyc = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
    for (let i = 0; i < 301; i++) c.move(cyc[i % 4] as string);
    expect(
      (await create(headers, 'a', { pgnOrUrl: c.pgn(), caption: '' })).json
    ).toMatchObject({
      message: expect.stringContaining('300'),
    });
    expect(
      (await create(headers, 'a', { pgnOrUrl: '', caption: '' })).json
    ).toMatchObject({
      message: 'Paste a PGN or a lichess.org game link.',
    });
    expect((await create(headers, 'a', { pgnOrUrl: 5 })).status).toBe(400);
  });

  test('a Reddit rejection is a clear error, with no fallback post as the app', async ({
    headers,
  }) => {
    const spy = stubUserActions();
    spy.mockRejectedValueOnce(
      new Error('To call this API with runAs USER ...')
    );
    const r = await as(headers, { username: 'ann' }, () =>
      call('POST', '/api/review/create', { pgnOrUrl: PGN, caption: '' })
    );
    expect(r.json).toMatchObject({
      message: "Reddit didn't accept the post. Try again later.",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('logged-out users cannot create', async ({ headers }) => {
    expect(
      (await create(headers, null, { pgnOrUrl: PGN, caption: '' })).status
    ).toBe(401);
  });

  locked(
    'members are refused when member posts are off; moderators are not',
    async ({ headers }) => {
      stubUserActions();
      expect(
        (await create(headers, 'm', { pgnOrUrl: PGN, caption: '' })).json
      ).toMatchObject({
        message: 'Member posts are off in this community.',
      });
      asMod();
      expect(
        (await create(headers, 'mod', { pgnOrUrl: PGN, caption: '' })).status
      ).toBe(200);
    }
  );

  test('checkmate and stalemate positions are spot-checked', async ({
    headers,
  }) => {
    const mate = '1. f3 e5 2. g4 Qh4# 0-1';
    const id = await makeReview(mate);
    const a = analysisFor(mate);
    expect((await submit(headers, 'x', id, a)).status).toBe(400); // cp 15 on a mate
    const last = a.positions.length - 1;
    a.positions[last] = { score: { mate: -1 }, best: null };
    expect((await submit(headers, 'y', id, a)).status).toBe(200);
  });
});

describe('lichess.org game links', () => {
  const LICHESS_PGN =
    '[Event "Rated blitz game"]\n[White "Polisay"]\n[Black "akakiy"]\n[Result "0-1"]\n[WhiteElo "2323"]\n[BlackElo "2313"]\n[TimeControl "180+0"]\n\n1. e4 e6 2. d4 d5 3. Nd2 c5 4. dxc5 Bxc5 5. Bd3 Nf6 6. Qe2 O-O 7. Ngf3 Nc6 8. a3 e5 9. O-O Bg4 10. h3 Nd4 11. Qd1 Bh5 12. exd5 Qxd5 13. g4 Nxg4 14. Nxd4 Ne3 15. Qxh5 Qg2# 0-1\n';
  const create = (h: Headers, url: string) =>
    as(h, { username: 'ann' }, () =>
      call('POST', '/api/review/create', { pgnOrUrl: url, caption: '' })
    );

  test('parses 8- and 12-char ids, /black and #ply suffixes', () => {
    for (const url of [
      'https://lichess.org/EwHRkfas',
      'lichess.org/EwHRkfas#29',
      'https://lichess.org/EwHRkfasAbCd',
      'https://www.lichess.org/EwHRkfas/black',
      'https://lichess.org/EwHRkfasAbCd/white?x=1',
    ])
      expect(lichessGameId(url), url).toBe('EwHRkfas');
    expect(lichessGameId('https://lichess.org/analysis/abc')).toBeNull();
    expect(lichessGameId('https://example.com/EwHRkfas')).toBeNull();
  });

  test('fetches the PGN with the right request and posts the review', async ({
    headers,
  }) => {
    stubUserActions();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(LICHESS_PGN, { status: 200 }));
    const r = await create(headers, 'https://lichess.org/EwHRkfas/black#29');
    expect(r.status).toBe(200);
    const [url, opts] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://lichess.org/game/export/EwHRkfas?clocks=false&evals=false'
    );
    expect(opts?.headers).toEqual({ Accept: 'application/x-chess-pgn' });
    const { postId } = r.json as { postId: string };
    expect((await init(headers, 'v', postId)).post).toMatchObject({
      white: 'Polisay',
    });
  });

  test('a 429 says Lichess is busy and backs off for a minute', async ({
    headers,
  }) => {
    stubUserActions();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 429 }));
    const busy = { message: 'Lichess is busy, try again in a minute.' };
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject(busy);
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject(busy);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('one request at a time: a held lock means busy', async ({ headers }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(LICHESS_PGN));
    await redis.hSet('lichess:lock', { held: String(Date.now()) });
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject({
      message: 'Lichess is busy, try again in a minute.',
    });
    // A stale lock (crashed request) is taken over.
    stubUserActions();
    await redis.hSet('lichess:lock', { held: String(Date.now() - 60_000) });
    expect((await create(headers, 'https://lichess.org/EwHRkfas')).status).toBe(
      200
    );
  });

  test('not found, sign-up redirects and network errors read plainly', async ({
    headers,
  }) => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject({
      message: "We couldn't find that Lichess game.",
    });
    spy.mockResolvedValueOnce(
      new Response('<!DOCTYPE html><title>Sign up</title>', { status: 200 })
    );
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject({
      message: "Couldn't get that game from Lichess. Paste the PGN instead.",
    });
    spy.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(
      (await create(headers, 'https://lichess.org/EwHRkfas')).json
    ).toMatchObject({
      message: "Couldn't get that game from Lichess. Paste the PGN instead.",
    });
    expect(
      (await create(headers, 'https://lichess.org/study/abc')).json
    ).toMatchObject({
      message: expect.stringContaining('lichess.org/abcd1234'),
    });
  });
});

describe('POST /api/review/analysis', () => {
  test('stores the first valid analysis and serves it to everyone', async ({
    headers,
  }) => {
    const id = await makeReview();
    const a = analysisFor();
    const r = await submit(headers, 'viewer1', id, a);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ type: 'reviewAnalysis', analysis: a });
    expect((await init(headers, null, id)).post).toMatchObject({ analysis: a });
  });

  test('logged-out viewers are rejected with 401 and nothing is stored', async ({
    headers,
  }) => {
    const id = await makeReview();
    expect((await submit(headers, null, id, analysisFor())).status).toBe(401);
    expect((await init(headers, null, id)).post).toMatchObject({
      analysis: null,
    });
  });

  test('rate limits each user separately', async ({ headers }) => {
    const id = await makeReview();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++)
      codes.push((await submit(headers, 'spammer', id, 'junk')).status);
    expect(codes).toEqual([400, 400, 400, 400, 400, 429, 429]);
    expect((await submit(headers, 'fresh', id, analysisFor())).status).toBe(
      200
    );
  });

  test('a second submission gets the stored one back, even a different one', async ({
    headers,
  }) => {
    const id = await makeReview();
    const first = analysisFor();
    const second = { ...analysisFor(), depth: 20, engine: 'Other' };
    await submit(headers, 'a', id, first);
    const r = await submit(headers, 'b', id, second);
    expect(r.json).toEqual({ type: 'reviewAnalysis', analysis: first });
  });

  test('simultaneous submissions agree on a single stored analysis', async ({
    headers,
  }) => {
    const id = await makeReview();
    const variants = [10, 12, 14, 16].map((depth) => ({
      ...analysisFor(),
      depth,
    }));
    const rs = await Promise.all(
      variants.map((v, i) => submit(headers, `u${i}`, id, v))
    );
    const depths = new Set(
      rs.map((r) => (r.json as { analysis: ReviewAnalysis }).analysis.depth)
    );
    expect(depths.size).toBe(1);
    const stored = (await init(headers, null, id)).post;
    expect(stored).toMatchObject({ analysis: { depth: [...depths][0] } });
  });

  test('rejects invalid analyses and stores nothing', async ({ headers }) => {
    const id = await makeReview();
    const short = analysisFor();
    short.positions.pop();
    const illegal = analysisFor();
    illegal.positions[0] = { score: { cp: 0 }, best: 'e2e5' };
    const huge = analysisFor();
    huge.positions[1] = { score: { cp: 20000 }, best: 'e7e5' };
    for (const [n, body] of [
      short,
      illegal,
      huge,
      { ...analysisFor(), depth: 3 },
      'junk',
      null,
    ].entries()) {
      expect((await submit(headers, `bad${n}`, id, body)).status).toBe(400);
    }
    expect((await init(headers, 'x', id)).post).toMatchObject({
      analysis: null,
    });
    // A good one still works afterwards.
    expect((await submit(headers, 'x', id, analysisFor())).status).toBe(200);
  });

  test('rate limits submissions per post', async ({ headers }) => {
    const id = await makeReview();
    let last = 0;
    for (let i = 0; i < 22; i++)
      last = (await submit(headers, `u${i}`, id, 'junk')).status;
    expect(last).toBe(429);
  });

  test('404s on posts that are not reviews', async ({ headers }) => {
    const r = await submit(headers, 'x', 't3_missing', analysisFor());
    expect(r.status).toBe(404);
  });
});

describe('resetting a review', () => {
  const reset = (h: Headers, user: string | null, postId: string) =>
    as(h, { username: user, postId }, () =>
      call('POST', '/api/review/reset', {})
    );

  test('the author can reset; others cannot; logged-out is 401', async ({
    headers,
  }) => {
    const id = await makeReview(PGN, 'author');
    await submit(headers, 'viewer', id, analysisFor());
    expect((await reset(headers, null, id)).status).toBe(401);
    expect((await reset(headers, 'viewer', id)).status).toBe(403);
    expect((await init(headers, 'viewer', id)).post).toMatchObject({
      analysis: expect.anything(),
      canReset: false,
    });
    expect((await init(headers, 'author', id)).post).toMatchObject({
      canReset: true,
    });

    expect((await reset(headers, 'author', id)).json).toEqual({
      type: 'reviewReset',
    });
    expect((await init(headers, 'viewer', id)).post).toMatchObject({
      analysis: null,
    });
    // A new analysis can now be stored.
    const redo = { ...analysisFor(), depth: 20 };
    await submit(headers, 'viewer', id, redo);
    expect((await init(headers, 'viewer', id)).post).toMatchObject({
      analysis: { depth: 20 },
    });
  });

  test('moderators can reset any review', async ({ headers }) => {
    const id = await makeReview(PGN, 'author');
    await submit(headers, 'viewer', id, analysisFor());
    asMod();
    expect((await init(headers, 'mod', id)).post).toMatchObject({
      canReset: true,
    });
    expect((await reset(headers, 'mod', id)).status).toBe(200);
    expect((await init(headers, 'mod', id)).post).toMatchObject({
      analysis: null,
    });
  });

  test('reset only applies to review posts', async ({ headers }) => {
    expect((await reset(headers, 'mod', 't3_none')).status).toBe(404);
  });
});

describe('POST /api/game/fetch', () => {
  const fetchGame = (h: Headers, u: string | null, url: unknown) =>
    as(h, { username: u }, () => call('POST', '/api/game/fetch', { url }));
  const PGN_TEXT = '[Event "Rated blitz game"]\n\n1. e4 e5 *\n';

  test('returns the PGN for a lichess game link', async ({ headers }) => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(PGN_TEXT));
    const r = await fetchGame(
      headers,
      'ann',
      'https://lichess.org/EwHRkfasAbCd/black'
    );
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ type: 'gameFetch', pgn: PGN_TEXT });
    expect(String(spy.mock.calls[0]?.[0])).toContain('/game/export/EwHRkfas');
  });

  test('needs login and a lichess game URL', async ({ headers }) => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(
      (await fetchGame(headers, null, 'https://lichess.org/EwHRkfas')).status
    ).toBe(401);
    for (const bad of [
      'https://example.com/x',
      'https://lichess.org/study/abc',
      5,
    ]) {
      const r = await fetchGame(headers, 'ann', bad);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({
        message: expect.stringContaining('lichess.org/abcd1234'),
      });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  test('passes on friendly Lichess errors', async ({ headers }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 404 })
    );
    expect(
      (await fetchGame(headers, 'ann', 'lichess.org/EwHRkfas')).json
    ).toMatchObject({
      message: "We couldn't find that Lichess game.",
    });
  });

  test('rate limits each user', async ({ headers }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(PGN_TEXT)
    );
    let last = 0;
    for (let i = 0; i < 21; i++)
      last = (await fetchGame(headers, 'busy', 'lichess.org/EwHRkfas')).status;
    expect(last).toBe(429);
    expect(
      (await fetchGame(headers, 'calm', 'lichess.org/EwHRkfas')).status
    ).toBe(200);
  });
});

describe('lichess fetches from member posts count against the fetch limit', () => {
  test('failed posts cannot loop lichess.org', async ({ headers }) => {
    stubUserActions();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('', { status: 404 }));
    const post = () =>
      as(headers, { username: 'loop' }, () =>
        call('POST', '/api/review/create', {
          pgnOrUrl: 'lichess.org/EwHRkfas',
          caption: '',
        })
      );
    for (let i = 0; i < 20; i++) await post();
    expect((await post()).json).toMatchObject({
      message: 'Slow down a little and try again.',
    });
    expect(spy).toHaveBeenCalledTimes(20);
    // The shared limit also blocks the plain fetch route.
    const r = await as(headers, { username: 'loop' }, () =>
      call('POST', '/api/game/fetch', { url: 'lichess.org/EwHRkfas' })
    );
    expect(r.status).toBe(429);
  });
});

describe('review titles use display names', () => {
  test('"Last, First" PGN names read naturally in the title and text fallback', async ({
    headers,
  }) => {
    const submitSpy = stubUserActions();
    await as(headers, { username: 'ann' }, () =>
      call('POST', '/api/review/create', {
        pgnOrUrl:
          '[White "Fischer, Robert James"]\n[Black "Spassky, Boris V."]\n[Result "1-0"]\n\n1. e4 e5 1-0',
        caption: '',
      })
    );
    expect(submitSpy.mock.calls[0]?.[0]).toMatchObject({
      title: 'Game review: Robert James Fischer vs Boris V. Spassky (1-0)',
      textFallback: {
        text: 'Game review: Robert James Fischer vs Boris V. Spassky (1-0)',
      },
    });
  });
});
