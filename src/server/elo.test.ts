import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type {
  EloGuessResponse,
  InitResponse,
  LeaderboardResponse,
} from '../shared/api';
import { Chess } from 'chess.js';
import { postEloGame } from './core/daily';
import { eloScore } from './core/elo';
import { getPost, keys } from './core/store';
import { as, asMod, at, call, stubUserActions } from './test-utils';

const test = createDevvitTest();
type Headers = Record<string, string | undefined>;

const MOVES =
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7';
const CURATED = [[`${MOVES} 1-0`, '600+0', '1-0', 1510, 1490]]; // average 1500

const json = <T>(r: { status: number; json: unknown }): T => {
  expect(r.status).toBe(200);
  return JSON.parse(JSON.stringify(r.json));
};
const postCurated = async (date = '2026-10-31') => {
  const r = await postEloGame(at(date, 13), CURATED);
  if (r.status !== 'posted') throw new Error(JSON.stringify(r));
  return r.postId;
};
const guess = (h: Headers, u: string | null, postId: string, g: unknown) =>
  as(h, { username: u, postId }, () =>
    call('POST', '/api/elo/guess', { guess: g })
  );
const init = async (h: Headers, u: string | null, postId: string) =>
  json<InitResponse>(
    await as(h, { username: u, postId }, () => call('GET', '/api/init'))
  );

describe('scoring', () => {
  test('100 minus a point per 10 off, never below 0', () => {
    expect(eloScore(1500, 1500)).toBe(100);
    expect(eloScore(1600, 1500)).toBe(90);
    expect(eloScore(1475, 1500)).toBe(98); // 97.5 rounds up
    expect(eloScore(400, 2600)).toBe(0);
  });
});

describe('POST /api/elo/guess', () => {
  test('hides the answer until the viewer guesses, then scores and reveals', async ({
    headers,
  }) => {
    const id = await postCurated();
    const before = (await init(headers, 'ann', id)).post;
    expect(before).toMatchObject({
      kind: 'elo',
      source: 'curated',
      author: null,
      number: 1,
      myGuess: null,
      reveal: null,
      me: { totalScore: 0, games: 0 },
      game: { timeControl: '600+0', result: '1-0' },
    });
    expect(JSON.stringify(before)).not.toContain('1510');
    const r = json<EloGuessResponse>(await guess(headers, 'ann', id, 1600));
    expect(r).toMatchObject({
      myGuess: 1600,
      myScore: 90,
      percentile: 100,
      reveal: {
        white: 1510,
        black: 1490,
        average: 1500,
        histogram: [{ bucket: 1600, count: 1 }],
        totalGuesses: 1,
      },
    });
    expect((await init(headers, 'ann', id)).post).toMatchObject({
      myGuess: 1600,
      myScore: 90,
      reveal: { average: 1500 },
      me: { totalScore: 90, games: 1 },
    });
  });

  test('percentile is the share of earlier guessers with a worse error', async ({
    headers,
  }) => {
    const id = await postCurated();
    await guess(headers, 'a', id, 2500); // error 1000
    await guess(headers, 'b', id, 1800); // error 300
    await guess(headers, 'c', id, 1400); // error 100
    const r = json<EloGuessResponse>(await guess(headers, 'd', id, 1700)); // error 200
    expect(r.percentile).toBe(67); // beat a and b of 3
    expect(r.reveal.histogram).toEqual([
      { bucket: 1400, count: 1 },
      { bucket: 1700, count: 1 },
      { bucket: 1800, count: 1 },
      { bucket: 2500, count: 1 },
    ]);
    expect(r.reveal.totalGuesses).toBe(4);
  });

  test('one final guess; must be logged in and on the 25-point grid', async ({
    headers,
  }) => {
    const id = await postCurated();
    expect((await guess(headers, null, id, 1500)).status).toBe(401);
    for (const bad of [399, 3001, 1510, 1500.5, '1500', null])
      expect((await guess(headers, 'e', id, bad)).status).toBe(400);
    expect((await guess(headers, 'e', id, 400)).status).toBe(200);
    const again = await guess(headers, 'e', id, 3000);
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ message: 'You already guessed.' });
  });

  test('simultaneous guesses by one user count once', async ({ headers }) => {
    const id = await postCurated();
    const rs = await Promise.all(
      [1500, 1525, 1550, 1575].map((g) => guess(headers, 'f', id, g))
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await init(headers, 'f', id)).post).toMatchObject({
      reveal: { totalGuesses: 1 },
      me: { games: 1 },
    });
  });

  test('the elo board is total score, shown after 3 games', async ({
    headers,
  }) => {
    const ids = [];
    for (const d of ['2026-10-31', '2026-11-07', '2026-11-14'])
      ids.push(await postCurated(d));
    const board = async () =>
      json<LeaderboardResponse>(
        await as(headers, { username: 'g' }, () =>
          call('GET', '/api/leaderboard?kind=elo')
        )
      );
    await guess(headers, 'g', ids[0] as string, 1500); // 100
    await guess(headers, 'g', ids[1] as string, 1600); // 90
    expect((await board()).entries).toEqual([]);
    await guess(headers, 'g', ids[2] as string, 1700); // 80
    expect((await board()).entries).toEqual([
      { rank: 1, username: 'g', value: 270 },
    ]);
    const p4 = await postCurated('2026-11-21');
    await guess(headers, 'g', p4, 1500);
    expect((await board()).me).toEqual({ rank: 1, username: 'g', value: 370 });
  });
});

describe('POST /api/elo/create (Guess my Elo)', () => {
  const create = (h: Headers, u: string | null, body: unknown) =>
    as(h, { username: u }, () => call('POST', '/api/elo/create', body));
  const pgn = (w: string, b: string, extra = '') =>
    `[Event "My game"]\n[White "Secret Name"]\n[Black "Other Name"]\n${extra}[WhiteElo "${w}"]\n[BlackElo "${b}"]\n[TimeControl "300+3"]\n[Result "1-0"]\n\n1. e4 {I was nervous} e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0`;

  test('a PGN with ratings becomes a self-reported game with names stripped', async ({
    headers,
  }) => {
    const submit = stubUserActions();
    const r = await create(headers, 'me', {
      pgnOrUrl: pgn('1200', '1250'),
      caption: '',
    });
    expect(r.status).toBe(200);
    const { postId } = r.json as { postId: string };
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      runAs: 'USER',
      title: 'Guess my Elo',
      postData: { card: { kind: 'elo', number: 0, timeControl: '300+3' } },
    });
    const stored = await getPost(postId);
    expect(stored).toMatchObject({
      kind: 'elo',
      number: 0,
      source: 'selfReported',
      author: 'me',
      white: 1200,
      black: 1250,
      game: { timeControl: '300+3', result: '1-0' },
    });
    const text = JSON.stringify([stored, submit.mock.calls[0]?.[0]]);
    for (const secret of ['Secret', 'Other Name', 'nervous', 'My game'])
      expect(text).not.toContain(secret);
    // The author sees the answer and cannot guess their own game.
    expect((await init(headers, 'me', postId)).post).toMatchObject({
      reveal: { average: 1225 },
    });
    expect((await guess(headers, 'me', postId, 1225)).status).toBe(409);
    expect((await init(headers, 'other', postId)).post).toMatchObject({
      reveal: null,
      caption: '',
    });
  });

  test('a caption makes the title', async ({ headers }) => {
    const submit = stubUserActions();
    await create(headers, 'me', {
      pgnOrUrl: pgn('1200', '1250'),
      caption: 'my first win',
    });
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Guess the Elo: my first win',
    });
  });

  test('validates ratings, length and variant', async ({ headers }) => {
    stubUserActions();
    const msg = async (body: string) =>
      (
        (await create(headers, 'me', { pgnOrUrl: body, caption: '' })).json as {
          message: string;
        }
      ).message;
    expect(await msg(pgn('?', '1200'))).toContain('Add WhiteElo and BlackElo');
    expect(await msg(pgn('50', '1200'))).toContain('100 to 3500');
    expect(await msg(pgn('1200', '3600'))).toContain('100 to 3500');
    expect(
      await msg('[WhiteElo "1200"]\n[BlackElo "1200"]\n\n1. e4 e5 2. Nf3 *')
    ).toContain('10 moves');
    expect(
      await msg(
        `[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n[WhiteElo "1200"]\n[BlackElo "1200"]\n\n1. e3 Kd7 *`
      )
    ).toContain('normal starting position');
  });

  test('a lichess link uses the real ratings and must be a rated game', async ({
    headers,
  }) => {
    stubUserActions();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response(
        pgn('2323', '2313', '[Site "https://lichess.org/EwHRkfas"]\n').replace(
          'My game',
          'Rated blitz game'
        )
      )
    );
    const r = await create(headers, 'me', {
      pgnOrUrl: 'https://lichess.org/EwHRkfas',
      caption: '',
    });
    expect(r.status).toBe(200);
    const { postId } = r.json as { postId: string };
    const stored = await getPost(postId);
    expect(stored).toMatchObject({
      source: 'lichess',
      white: 2323,
      black: 2313,
    });
    expect(JSON.stringify(stored)).not.toContain('EwHRkfas');

    fetchSpy.mockResolvedValueOnce(
      new Response(pgn('1500', '1500').replace('My game', 'Casual blitz game'))
    );
    expect(
      (
        await create(headers, 'me', {
          pgnOrUrl: 'https://lichess.org/AbCdEfGh',
          caption: '',
        })
      ).json
    ).toMatchObject({ message: 'Only rated Lichess games can be used.' });
  });

  test('shares the member quota and the memberPosts switch', async ({
    headers,
  }) => {
    stubUserActions();
    for (let i = 0; i < 5; i++)
      expect(
        (
          await create(headers, 'q', {
            pgnOrUrl: pgn('1200', '1200'),
            caption: '',
          })
        ).status
      ).toBe(200);
    expect(
      (
        await create(headers, 'q', {
          pgnOrUrl: pgn('1200', '1200'),
          caption: '',
        })
      ).json
    ).toMatchObject({
      message: expect.stringContaining('5 posts a day'),
    });
    asMod();
    expect(
      (
        await create(headers, 'q', {
          pgnOrUrl: pgn('1200', '1200'),
          caption: '',
        })
      ).status
    ).toBe(200);
    expect(
      (await create(headers, null, { pgnOrUrl: pgn('1200', '1200') })).status
    ).toBe(401);
  });
});

describe('cleanup on post delete', () => {
  test('removes everything stored for the post but keeps user totals', async ({
    headers,
  }) => {
    const id = await postCurated();
    await guess(headers, 'h', id, 1500);
    const r = await call('POST', '/internal/triggers/on-post-delete', {
      type: 'PostDelete',
      postId: id,
    });
    expect(r.status).toBe(200);
    for (const k of [
      keys.post(id),
      keys.eloGuesses(id),
      keys.eloHist(id),
      keys.eloErrors(id),
    ])
      expect(await redis.exists(k)).toBe(0);
    expect(await redis.hGet(keys.user('h'), 'eloTotal')).toBe('100');
    const v = await as(headers, { username: 'h', postId: id }, () =>
      call('GET', '/api/init')
    );
    expect(v.status).toBe(404);
  });
});

describe('post data', () => {
  test('curated and member Elo posts preview the final position, White at the bottom', async ({
    headers,
    mocks,
  }) => {
    const end = new Chess();
    end.loadPgn(MOVES);
    const curated = await postCurated();
    expect(mocks.reddit.linksAndComments.getPostData(curated)).toEqual({
      kind: 'elo',
      fen: end.fen(),
      orientation: 'white',
      card: { kind: 'elo', number: 1, timeControl: '600+0' },
    });
    stubUserActions();
    const r = await as(headers, { username: 'me' }, () =>
      call('POST', '/api/elo/create', {
        pgnOrUrl: `[WhiteElo "1200"]\n[BlackElo "1300"]\n\n${MOVES} *`,
        caption: '',
      })
    );
    const { postId } = r.json as { postId: string };
    expect(mocks.reddit.linksAndComments.getPostData(postId)).toEqual({
      kind: 'elo',
      fen: end.fen(),
      orientation: 'white',
      card: { kind: 'elo', number: 0, timeControl: expect.any(String) },
    });
  });
});
