import { redis } from '@devvit/web/server';
import type { ReviewAnalysis } from '../../shared/api';
import { parseGame, validateAnalysis } from '../../shared/chess/review';
import { keys, parseJson, type StoredReviewPost } from './store';

const FIELD = 'analysis';
// Submissions (valid or not) allowed per post per hour.
export const SUBMISSIONS_PER_HOUR = 20;
// Per user per post per hour.
export const USER_SUBMISSIONS_PER_HOUR = 5;

export const getAnalysis = async (
  postId: string
): Promise<ReviewAnalysis | null> => {
  const data = parseJson(await redis.hGet(keys.review(postId), FIELD));
  // Only ever written by submitAnalysis after validateAnalysis.
  return typeof data === 'object' && data !== null
    ? (data as ReviewAnalysis)
    : null;
};

export type SubmitOutcome =
  | { ok: true; analysis: ReviewAnalysis }
  | { ok: false; status: 400 | 429; message: string };

/** Store the first valid analysis; later calls get the stored one back. */
export const submitAnalysis = async (
  postId: string,
  post: StoredReviewPost,
  username: string,
  input: unknown
): Promise<SubmitOutcome> => {
  const existing = await getAnalysis(postId);
  if (existing) return { ok: true, analysis: existing };

  const mine = await redis.incrBy(keys.reviewUserSubs(postId, username), 1);
  if (mine === 1)
    await redis.expire(keys.reviewUserSubs(postId, username), 3600);
  if (mine > USER_SUBMISSIONS_PER_HOUR)
    return {
      ok: false,
      status: 429,
      message: 'Too many submissions, try later.',
    };

  const n = await redis.incrBy(keys.reviewSubs(postId), 1);
  if (n === 1) await redis.expire(keys.reviewSubs(postId), 3600);
  if (n > SUBMISSIONS_PER_HOUR)
    return {
      ok: false,
      status: 429,
      message: 'Too many submissions, try later.',
    };

  const game = parseGame(post.pgn);
  if ('error' in game) {
    console.error(`review ${postId}: stored PGN no longer parses`);
    return {
      ok: false,
      status: 400,
      message: 'Something went wrong. Try again.',
    };
  }
  const valid = validateAnalysis(input, game.fens);
  if ('error' in valid) {
    // The engine output came from our own client; the detail is for us.
    console.error(`review ${postId}: rejected analysis: ${valid.error}`);
    return {
      ok: false,
      status: 400,
      message: 'Something went wrong. Try again.',
    };
  }

  // hSetNX is the atomic "first wins" gate.
  const won =
    (await redis.hSetNX(keys.review(postId), FIELD, JSON.stringify(valid))) ===
    1;
  if (won) return { ok: true, analysis: valid };
  return { ok: true, analysis: (await getAnalysis(postId)) ?? valid };
};

/** Clear the stored analysis so the next viewer re-runs the engine. */
export const resetAnalysis = async (postId: string): Promise<void> => {
  await redis.hDel(keys.review(postId), [FIELD]);
};
