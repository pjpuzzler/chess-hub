// onPostDelete: remove everything stored for a post (Devvit rules). User
// aggregates (rating, streaks, totals) are kept.
import { redis } from '@devvit/web/server';
import { forgetGamePost } from './game';
import { DELETED } from './daily';
import { getPost, keys, parseJson } from './store';

export const deletePostData = async (postId: string): Promise<void> => {
  // A scheduled post's date is marked deleted: the hourly retry leaves the
  // day alone, and the mod menu can post a replacement.
  const post = await getPost(postId);
  if (post?.kind === 'game') await forgetGamePost(postId);
  const series =
    post?.kind === 'puzzle'
      ? 'daily'
      : post?.kind === 'elo' && post.source === 'curated'
        ? 'elo'
        : null;
  if (post && series && 'date' in post) {
    if ((await redis.hGet(keys.dates(series), post.date)) === postId)
      await redis.hSet(keys.dates(series), {
        [post.date]: `${DELETED}${postId}`,
      });
    if ((await redis.get(keys.pinned(series))) === postId)
      await redis.del(keys.pinned(series));
    const latest = parseJson(await redis.get(keys.latestPost(series)));
    if (
      typeof latest === 'object' &&
      latest &&
      Reflect.get(latest, 'postId') === postId
    )
      await redis.del(keys.latestPost(series));
  }
  await redis.del(
    keys.post(postId),
    keys.stats(postId),
    keys.attempts(postId),
    keys.votes(postId),
    keys.counts(postId),
    keys.review(postId),
    keys.reviewSubs(postId),
    keys.eloGuesses(postId),
    keys.eloHist(postId),
    keys.eloErrors(postId)
  );
};
