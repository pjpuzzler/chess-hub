import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect } from 'vitest';
import type { InitResponse } from '../shared/api';
import { anarchyDay, type AnarchySet } from './core/anarchy';
import { postDailyPuzzle } from './core/daily';
import { getPost, keys } from './core/store';
import { SET, as, at, call, row } from './test-utils';

const base = { pinDailyPuzzle: 'off' };
const auto = createDevvitTest({ settings: base }); // subreddit "testsub"
const autoAnarchy = createDevvitTest({
  subredditName: 'AnarchyChess',
  settings: base,
});
const lower = createDevvitTest({
  subredditName: 'anarchychess',
  settings: base,
});
const forced = autoAnarchy;

const P = '6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1';
const themed = (prefix: string) => [
  row(`${prefix}1`, P, 'a7a6 d1d8'),
  row(`${prefix}2`, P, 'a7a5 d1d8'),
];
const ANARCHY: AnarchySet = {
  enPassant: themed('ep'),
  knightBoost: themed('kb'),
  doubleCheck: themed('dc'),
  smothered: themed('sm'),
  rookSac: themed('rs'),
};

const post = async (date: string, set: AnarchySet = ANARCHY) => {
  const r = await postDailyPuzzle(at(date, 13), SET, set);
  if (r.status !== 'posted') throw new Error(JSON.stringify(r));
  return r.postId;
};
const init = async (h: Record<string, string | undefined>, postId: string) =>
  (await as(h, { username: 'a', postId }, () => call('GET', '/api/init')))
    .json as InitResponse;

describe('anarchy weekday table', () => {
  auto('maps each UTC weekday to its theme and exact tagline', () => {
    // 2026-11-01 is a Sunday.
    const week = ['01', '02', '03', '04', '05', '06', '07'].map((d) =>
      anarchyDay(`2026-11-${d}`)
    );
    expect(week).toEqual([
      { bucket: 'enPassant', tagline: 'En passant is forced' },
      { bucket: 'enPassant', tagline: 'Google en passant' },
      { bucket: 'knightBoost', tagline: 'Knight boost' },
      { bucket: 'doubleCheck', tagline: 'Double check wins the game' },
      { bucket: 'enPassant', tagline: 'Holy hell' },
      { bucket: 'smothered', tagline: 'The horsey has had enough' },
      { bucket: 'rookSac', tagline: 'Sacrifice the rook' },
    ]);
  });
});

describe('anarchy only in r/AnarchyChess', () => {
  autoAnarchy(
    'auto means anarchy in r/AnarchyChess: themed puzzle, title and tagline',
    async ({ headers }) => {
      const id = await post('2026-11-02'); // Monday
      expect((await reddit.getPostById(id as `t3_${string}`)).title).toBe(
        'Daily Anarchy Puzzle #1 · White to move · Nov 2'
      );
      expect(await getPost(id)).toMatchObject({
        puzzle: { id: 'ep1' },
        tagline: 'Google en passant',
      });
      const body = await init(headers, id);
      expect(body.flags.anarchy).toBe(true);
      expect(body.post).toMatchObject({ tagline: 'Google en passant' });
    }
  );

  auto(
    'auto elsewhere is classic: no tagline, normal title, flag off',
    async ({ headers }) => {
      const id = await post('2026-11-02');
      expect((await reddit.getPostById(id as `t3_${string}`)).title).toBe(
        'Daily Puzzle #1 · White to move · Nov 2'
      );
      const body = await init(headers, id);
      expect(body.flags.anarchy).toBe(false);
      expect(body.post).toMatchObject({ tagline: null, puzzle: { id: 'e1' } });
    }
  );

  lower('the subreddit match is case-insensitive', async ({ headers }) => {
    const id = await post('2026-11-06'); // Friday
    expect((await init(headers, id)).post).toMatchObject({
      tagline: 'The horsey has had enough',
    });
  });

  forced(
    'each theme has one cursor across its days and never repeats until used up',
    async () => {
      const ids = [];
      // Monday, Thursday and Sunday are all en passant; then a Tuesday.
      for (const d of [
        '2026-11-02',
        '2026-11-05',
        '2026-11-08',
        '2026-11-03',
      ]) {
        const p = await getPost(await post(d));
        ids.push(p?.kind === 'puzzle' ? p.puzzle.id : null);
      }
      expect(ids).toEqual(['ep1', 'ep2', 'ep1', 'kb1']);
      expect(await redis.get(keys.cursor('daily', 'anarchy:enPassant'))).toBe(
        '3'
      );
      expect(await redis.get(keys.cursor('daily', 'anarchy:knightBoost'))).toBe(
        '1'
      );
      expect(await redis.get(keys.cursor('daily', 'medium'))).toBeUndefined();
    }
  );

  forced(
    'an empty theme falls back to the classic puzzle',
    async ({ headers }) => {
      const id = await post('2026-11-02', { ...ANARCHY, enPassant: [] });
      expect((await init(headers, id)).post).toMatchObject({
        tagline: null,
        puzzle: { id: 'e1' },
      });
    }
  );
});
