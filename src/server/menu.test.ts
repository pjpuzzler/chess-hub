import { createDevvitTest } from '@devvit/test/server/vitest';
import { describe, expect, vi } from 'vitest';
import { getPost } from './core/store';
import { as, asMod, call, stubUserActions } from './test-utils';

const test = createDevvitTest();
const off = createDevvitTest({ settings: { memberPosts: false } });

const PGN =
  '[White "Ann"]\n[Black "Bob"]\n[Result "1-0"]\n[WhiteElo "1200"]\n[BlackElo "1300"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0';

const forms = [
  {
    menu: 'poll-new',
    form: 'poll-submit',
    name: 'pollForm',
    body: { position: '1. e4 e5 2. Nf3', closeHours: 12 },
    done: 'Poll posted.',
  },
  {
    menu: 'review-new',
    form: 'review-submit',
    name: 'reviewForm',
    body: { game: PGN },
    done: 'Review posted.',
  },
  {
    menu: 'elo-new',
    form: 'elo-submit',
    name: 'eloForm',
    body: { game: PGN, caption: 'my win' },
    done: 'Posted. Others can guess now.',
  },
];

describe('member menu items', () => {
  test('each opens its form for members', async () => {
    for (const f of forms)
      expect(
        (await call('POST', `/internal/menu/${f.menu}`, {})).json
      ).toMatchObject({
        showForm: { name: f.name },
      });
  });

  test('each form posts as the user through the in-app code', async () => {
    const submit = stubUserActions();
    for (const f of forms) {
      const r = await call('POST', `/internal/form/${f.form}`, f.body);
      expect(r.json).toMatchObject({
        showToast: { text: f.done },
        navigateTo: expect.any(String),
      });
    }
    expect(submit.mock.calls.map((c) => [c[0].runAs, c[0].title])).toEqual([
      ['USER', "What's the move? · Black to play"],
      ['USER', 'Game review: Ann vs Bob (1-0)'],
      ['USER', 'Guess the Elo: my win'],
    ]);
  });

  test('the Guess my Elo form strips names like the in-app route', async ({
    mocks,
  }) => {
    stubUserActions();
    await call('POST', '/internal/form/elo-submit', { game: PGN });
    const id = [
      ...mocks.reddit.linksAndComments['_store'].postData.keys(),
    ][0] as string;
    const stored = await getPost(id);
    expect(stored).toMatchObject({
      kind: 'elo',
      source: 'selfReported',
      white: 1200,
      black: 1300,
    });
    expect(JSON.stringify(stored)).not.toContain('Ann');
  });

  test('forms share the 5-a-day member quota; the menu says so once it is used', async () => {
    stubUserActions();
    for (let i = 0; i < 5; i++)
      await call('POST', '/internal/form/poll-submit', forms[0]?.body);
    const msg = 'You can make 5 posts a day. Try again tomorrow.';
    expect(
      (await call('POST', '/internal/form/review-submit', { game: PGN })).json
    ).toEqual({ showToast: msg });
    expect((await call('POST', '/internal/menu/elo-new', {})).json).toEqual({
      showToast: msg,
    });
  });

  test('form errors are plain toasts and do not use the quota', async () => {
    stubUserActions();
    expect(
      (await call('POST', '/internal/form/poll-submit', { position: '' })).json
    ).toEqual({
      showToast: 'Enter a FEN, a PGN or a lichess.org analysis link.',
    });
    expect(
      (await call('POST', '/internal/form/elo-submit', { game: '1. e4 e5' }))
        .json
    ).toMatchObject({
      showToast: expect.stringContaining('10 moves'),
    });
    for (let i = 0; i < 5; i++)
      expect(
        (await call('POST', '/internal/form/poll-submit', forms[0]?.body)).json
      ).toMatchObject({
        showToast: { text: 'Poll posted.' },
      });
  });

  test('logged-out users are asked to log in', async ({ headers }) => {
    for (const f of forms) {
      const m = await as(headers, { username: null }, () =>
        call('POST', `/internal/menu/${f.menu}`, {})
      );
      expect(m.json).toEqual({ showToast: 'Log in first.' });
      const r = await as(headers, { username: null }, () =>
        call('POST', `/internal/form/${f.form}`, f.body)
      );
      expect(r.json).toEqual({ showToast: 'Log in first.' });
    }
  });

  off(
    'when member posts are off, members get one clear toast; mods still post',
    async () => {
      stubUserActions();
      const msg = { showToast: 'Member posts are off in this community.' };
      for (const f of forms) {
        expect(
          (await call('POST', `/internal/menu/${f.menu}`, {})).json
        ).toEqual(msg);
        expect(
          (await call('POST', `/internal/form/${f.form}`, f.body)).json
        ).toEqual(msg);
      }
      asMod();
      expect(
        (await call('POST', '/internal/menu/poll-new', {})).json
      ).toMatchObject({
        showForm: { name: 'pollForm' },
      });
      expect(
        (await call('POST', '/internal/form/poll-submit', forms[0]?.body)).json
      ).toMatchObject({
        showToast: { text: 'Poll posted.' },
      });
    }
  );

  test('unexpected errors are a generic toast', async () => {
    stubUserActions().mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await call('POST', '/internal/form/review-submit', { game: PGN });
    expect(r.json).toEqual({
      showToast: "Reddit didn't accept the post. Try again later.",
    });
  });
});
