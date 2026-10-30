// Helpers for route tests: call the Hono app as different users/posts.
import { Context, runWithContext } from '@devvit/server';
import { Header } from '@devvit/shared-types/Header.js';
import { reddit } from '@devvit/web/server';
import { vi } from 'vitest';
import { app } from './app';
import type { PuzzleSet } from './core/puzzles';

export type Who = { username: string | null; postId?: string };

type Headers = Record<string, string | undefined>;

/** Run `fn` as another user (or logged out with username null) on a post. */
export const as = <T>(
  base: Headers,
  who: Who,
  fn: () => Promise<T>
): Promise<T> => {
  const headers: Headers = { ...base };
  if (who.username === null) {
    delete headers[Header.User];
    delete headers[Header.Username];
  } else {
    headers[Header.User] = `t2_${who.username}`;
    headers[Header.Username] = who.username;
  }
  if (who.postId) headers[Header.Post] = who.postId;
  return runWithContext(Context(headers), fn);
};

export const call = async (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json() };
};

/** Date at a given UTC day/hour. */
export const at = (date: string, hour = 0): Date =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

// Three tiny puzzles per bucket (mate in one after a pawn setup move).
export const row = (id: string, fen: string, moves: string): unknown[] => [
  id,
  fen,
  moves,
  1000,
  'mate',
];
const bucket = (prefix: string) => [
  row(`${prefix}1`, '6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', 'a7a6 d1d8'),
  row(`${prefix}2`, '6k1/p4ppp/8/8/8/8/5PPP/2R3K1 b - - 0 1', 'a7a5 c1c8'),
  row(`${prefix}3`, '7k/p7/5K2/8/8/8/8/6Q1 b - - 0 1', 'a7a6 g1g7'),
];
// Same puzzles in every bucket so tests do not depend on the weekday.
export const SET: PuzzleSet = {
  easy: bucket('e'),
  medium: bucket('e'),
  hard: bucket('e'),
};

/** Make every user a moderator for this test (the harness has no mod list). */
export const asMod = () =>
  vi.spyOn(reddit, 'getModerators').mockReturnValue({
    all: async () => [{}],
  } as unknown as ReturnType<typeof reddit.getModerators>);

/**
 * The harness has no user-actions plugin, so `runAs: 'USER'` throws. Drop the
 * user-action options and post as the harness user; calls still record them.
 */
export const stubUserActions = () => {
  if (vi.isMockFunction(reddit.submitCustomPost))
    return vi.mocked(reddit.submitCustomPost);
  const orig = reddit.submitCustomPost.bind(reddit);
  return vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementation(({ runAs: _r, userGeneratedContent: _u, ...rest }) =>
      orig(rest)
    );
};

/** Every account "still exists" for the hourly deletion sweep. */
export const accountsExist = () =>
  vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue({ username: 'x' } as unknown as Awaited<
      ReturnType<typeof reddit.getUserByUsername>
    >);
