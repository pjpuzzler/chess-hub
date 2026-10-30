import { Hono } from 'hono';
import type { OnPostDeleteRequest, TriggerResponse } from '@devvit/web/shared';
import { deletePostData } from '../core/cleanup';
import { postDailyPuzzle } from '../core/daily';

export const triggers = new Hono();

// Daily Puzzle #1 right away. The hourly cron is (re)scheduled by Devvit from
// devvit.json on install and upgrade, and nothing needs migrating yet, so
// there is no onAppUpgrade handler.
triggers.post('/on-app-install', async (c) => {
  const res = await postDailyPuzzle();
  return c.json<TriggerResponse>({
    status: res.status === 'error' ? 'error' : 'success',
    message: res.status,
  });
});

// Devvit rules: delete what we stored when a post is deleted.
triggers.post('/on-post-delete', async (c) => {
  const body = await c.req.json<OnPostDeleteRequest>();
  const postId = body.postId;
  if (postId) await deletePostData(`t3_${postId.replace(/^t3_/, '')}`);
  return c.json<TriggerResponse>({ status: 'success', message: 'ok' });
});
