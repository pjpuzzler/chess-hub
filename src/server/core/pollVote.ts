import { redis } from '@devvit/web/server';
import type { PollResult, PollVoteResponse } from '../../shared/api';
import { checkMove, tally } from '../../shared/chess/poll';
import { expireClosedVotes, touchUser } from './privacy';
import { keys, toInt, type StoredPollPost } from './store';

export const isClosed = (post: StoredPollPost, now: number): boolean =>
  post.closesAt !== null && now >= post.closesAt;

export const getCounts = async (
  postId: string
): Promise<Record<string, number>> => {
  const raw = await redis.hGetAll(keys.counts(postId));
  return Object.fromEntries(
    Object.entries(raw).map(([move, n]) => [move, toInt(n)])
  );
};

export const getResults = async (
  postId: string,
  post: StoredPollPost
): Promise<{ results: PollResult[]; totalVotes: number }> => {
  const counts = await getCounts(postId);
  const results = tally(post.fen, counts);
  return {
    results,
    totalVotes: results.reduce((sum, r) => sum + r.votes, 0),
  };
};

export type VoteOutcome =
  | { ok: true; response: PollVoteResponse }
  | { ok: false; status: 400 | 409; message: string };

/**
 * Cast a user's single, final vote. `hSetNX` on the voter hash is the atomic
 * gate: only the request that creates the field increments the count, so
 * concurrent duplicate requests cannot double-count.
 */
export const castVote = async (
  username: string,
  postId: string,
  post: StoredPollPost,
  move: string,
  now: number = Date.now()
): Promise<VoteOutcome> => {
  if (isClosed(post, now))
    return { ok: false, status: 409, message: 'This poll is closed.' };
  const checked = checkMove(post.fen, move);
  if (!checked)
    return {
      ok: false,
      status: 400,
      message: 'That is not a legal move here.',
    };

  await touchUser(username, { postId });
  const claimed = await redis.hSetNX(keys.votes(postId), username, checked.uci);
  // Who voted for what is dropped some time after the poll closes; counts stay.
  if (post.closesAt !== null)
    await expireClosedVotes(keys.votes(postId), post.closesAt, now);
  if (claimed !== 1)
    return { ok: false, status: 409, message: 'You have already voted.' };
  try {
    await redis.hIncrBy(keys.counts(postId), checked.uci, 1);
  } catch (e) {
    await redis.hDel(keys.votes(postId), [username]);
    throw e;
  }
  const { results, totalVotes } = await getResults(postId, post);
  return {
    ok: true,
    response: { type: 'pollVote', myVote: checked.uci, totalVotes, results },
  };
};

/** Close a poll immediately (idempotent: keeps an earlier close time). */
export const closeNow = (
  post: StoredPollPost,
  now: number = Date.now()
): StoredPollPost => ({
  ...post,
  closesAt: post.closesAt === null ? now : Math.min(post.closesAt, now),
});
