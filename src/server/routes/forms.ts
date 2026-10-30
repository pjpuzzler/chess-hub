import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { createEloMemberPost } from '../core/elo';
import { endGame, startGame } from '../core/game';
import { isModerator } from '../core/settings';
import {
  asMemberPost,
  createPollPost,
  createReviewPost,
  GENERIC,
  postUrl,
  type CreateResult,
} from '../core/posts';
import { currentUsername } from '../core/views';

export const forms = new Hono();

const readValues = async (c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown>> => {
  try {
    const body = await c.req.json();
    return typeof body === 'object' && body !== null
      ? Object.fromEntries(Object.entries(body))
      : {};
  } catch {
    return {};
  }
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// Member forms go through the same code as the in-app routes: the
// memberPosts setting, the shared daily quota and posting as the user.
const memberSubmit = (
  name: string,
  done: string,
  run: (v: Record<string, unknown>, username: string) => Promise<CreateResult>
) =>
  forms.post(`/${name}`, async (c) => {
    const v = await readValues(c);
    try {
      const username = await currentUsername();
      if (!username) return c.json<UiResponse>({ showToast: 'Log in first.' });
      const res = await asMemberPost(username, () => run(v, username));
      if (!res.ok) return c.json<UiResponse>({ showToast: res.error });
      return c.json<UiResponse>({
        showToast: { text: done, appearance: 'success' },
        navigateTo: postUrl(res.postId),
      });
    } catch (e) {
      console.error(`${name} failed: ${e}`);
      return c.json<UiResponse>({ showToast: GENERIC });
    }
  });

memberSubmit('poll-submit', 'Poll posted.', (v) =>
  createPollPost({
    position: str(v['position']),
    prompt: str(v['prompt']),
    closeHours: typeof v['closeHours'] === 'number' ? v['closeHours'] : 0,
    orientation: 'auto',
    asUser: true,
  })
);

memberSubmit('review-submit', 'Review posted.', (v, username) =>
  createReviewPost(
    { pgnOrUrl: str(v['game']), caption: str(v['caption']) },
    username
  )
);

memberSubmit('elo-submit', 'Posted. Others can guess now.', (v, username) =>
  createEloMemberPost(
    { pgnOrUrl: str(v['game']), caption: str(v['caption']) },
    username
  )
);

// ---- community game (mods; re-checked because forms take direct POSTs) ----

const requireMod = async () => {
  const username = await currentUsername();
  return username !== null && (await isModerator(username));
};

forms.post('/game-start', async (c) => {
  if (!(await requireMod()))
    return c.json<UiResponse>({ showToast: 'Only moderators can do that.' });
  const res = await startGame();
  if (!res.ok) return c.json<UiResponse>({ showToast: res.error });
  return c.json<UiResponse>({
    showToast: { text: 'Community game started.', appearance: 'success' },
    navigateTo: postUrl(res.postId),
  });
});

forms.post('/game-end', async (c) => {
  if (!(await requireMod()))
    return c.json<UiResponse>({ showToast: 'Only moderators can do that.' });
  const ended = await endGame();
  return c.json<UiResponse>({
    showToast: ended
      ? { text: 'Community game ended.', appearance: 'success' }
      : 'No community game is running.',
  });
});
