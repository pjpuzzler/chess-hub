import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { postDailyPuzzle, postEloGame, utcDate } from '../core/daily';
import { advanceGame } from '../core/game';
import { sweepUsers } from '../core/privacy';
import { eloDue, getSettings } from '../core/settings';

export const scheduler = new Hono();

// Hourly cron. Posts once the configured UTC hour has come, so a skipped run
// is made up later the same day; date claims keep each series to one post per
// UTC date.
scheduler.post('/daily-puzzle', async (c) => {
  const now = new Date();
  // Account-deletion sweep runs every hour, independent of the posting hour.
  await sweepUsers(now.getTime()).catch((e) =>
    console.error(`user sweep failed: ${e}`)
  );
  const s = await getSettings();
  if (now.getUTCHours() < s.postHourUtc)
    return c.json<TaskResponse>({ status: 'ok' });
  if (s.dailyPuzzle) await postDailyPuzzle(now);
  if (eloDue(s.elo, utcDate(now))) await postEloGame(now);
  await advanceGame(now);
  return c.json<TaskResponse>({ status: 'ok' });
});
