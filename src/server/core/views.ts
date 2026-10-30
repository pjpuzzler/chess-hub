import { context, redis, reddit } from '@devvit/web/server';
import type { PostView } from '../../shared/api';
import { getResults, isClosed } from './pollVote';
import { currentElo, nextPuzzleAt } from './daily';
import { buildEloView } from './elo';
import { buildGameView } from './game';
import { getMe, getStats, hasFinished, publicPuzzle } from './puzzle';
import { getAnalysis } from './review';
import { keys, type StoredPost } from './store';

/** Logged-in username, or null for logged-out viewers. */
export const currentUsername = async (): Promise<string | null> => {
  if (!context.userId) return null;
  return context.username ?? (await reddit.getCurrentUsername()) ?? null;
};

export const buildView = async (
  postId: string,
  post: StoredPost,
  username: string | null,
  now: number = Date.now(),
  isMod = false
): Promise<PostView> => {
  switch (post.kind) {
    case 'puzzle': {
      const [stats, me, finished, next, elo] = await Promise.all([
        getStats(postId),
        username ? getMe(username, postId) : Promise.resolve(null),
        hasFinished(username, postId),
        nextPuzzleAt(new Date(now)),
        currentElo(),
      ]);
      return {
        kind: 'puzzle',
        number: post.number,
        date: post.date,
        puzzle: publicPuzzle(post.puzzle, finished),
        stats,
        me,
        nextPuzzleAt: next,
        tagline: post.tagline ?? null,
        currentElo: elo,
      };
    }
    case 'poll': {
      const myVote = username
        ? ((await redis.hGet(keys.votes(postId), username)) ?? null)
        : null;
      const { results, totalVotes } = await getResults(postId, post);
      const visible = myVote !== null || isClosed(post, now);
      return {
        kind: 'poll',
        fen: post.fen,
        prompt: post.prompt,
        lastMove: post.lastMove,
        closesAt: post.closesAt,
        totalVotes,
        myVote,
        results: visible ? results : null,
      };
    }
    case 'review':
      return {
        kind: 'review',
        pgn: post.pgn,
        white: post.white,
        black: post.black,
        result: post.result,
        caption: post.caption,
        author: post.author,
        analysis: await getAnalysis(postId),
        canReset: username !== null && (username === post.author || isMod),
      };
    case 'elo':
      return buildEloView(postId, post, username);
    case 'game':
      return buildGameView(postId, post, username);
  }
};
