// Pin the newest Daily Puzzle and unpin the previous one. Pinning must never
// break posting, so every step is best-effort.
import { reddit, redis } from '@devvit/web/server';
import type { PinMode } from './settings';
import { keys } from './store';

const asPostId = (id: string): `t3_${string}` => `t3_${id.replace(/^t3_/, '')}`;

const step = async (what: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    console.error(`pin: ${what} failed: ${e}`);
  }
};

/** Pin the new daily puzzle (highlight or sticky slot 2) and unpin the last. */
export const pinNewDaily = async (postId: string, mode: PinMode) => {
  if (mode === 'off') return;
  const series = 'daily';
  const key = keys.pinned(series);
  const previous = await redis.get(key).catch(() => undefined);
  if (previous && previous !== postId) {
    await step(`unpin previous ${series}`, async () => {
      const old = await reddit.getPostById(asPostId(previous));
      // Undo both in case the setting changed since the last post.
      await old.unsticky().catch(() => undefined);
      await old.unhighlight().catch(() => undefined);
    });
  }
  await step(`pin new ${series}`, async () => {
    const post = await reddit.getPostById(asPostId(postId));
    await post.distinguish();
    await (mode === 'sticky' ? post.sticky(2) : post.highlight());
  });
  await step('remember pinned', () => redis.set(key, postId));
};

const DAY_MS = 24 * 3_600_000;

/**
 * Highlight mode only: highlight a new curated Guess the Elo post for its
 * first day. The highlight expires on its own, so nothing is tracked.
 */
export const highlightEloForADay = async (
  postId: string,
  mode: PinMode,
  now: Date
) => {
  if (mode !== 'highlight') return;
  await step('highlight elo', async () => {
    const post = await reddit.getPostById(asPostId(postId));
    await post.highlight({ highlightUntil: new Date(now.getTime() + DAY_MS) });
  });
};

// Highlights outlive the next post by this much, so there is no gap.
const HIGHLIGHT_MARGIN_MS = 2 * 3_600_000;

/** Next posting time after `now` (the hourly task posts on the hour). */
export const nextPostTime = (now: Date, postHourUtc: number): Date => {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    postHourUtc
  );
  return new Date(today > now.getTime() ? today : today + DAY_MS);
};

/**
 * Community game: highlight the current game post until just after the next
 * post time, and drop the highlight from the previous one, so one game post
 * is highlighted at a time. Best effort: never blocks the game.
 */
export const highlightGamePost = async (
  postId: string,
  previousId: string | null,
  enabled: boolean,
  postHourUtc: number,
  now: Date
) => {
  if (!enabled) return;
  if (previousId && previousId !== postId)
    await step('unhighlight previous game post', async () => {
      const old = await reddit.getPostById(asPostId(previousId));
      await old.unhighlight();
    });
  await step('highlight game post', async () => {
    const post = await reddit.getPostById(asPostId(postId));
    const until =
      nextPostTime(now, postHourUtc).getTime() + HIGHLIGHT_MARGIN_MS;
    await post.highlight({ highlightUntil: new Date(until) });
  });
};
