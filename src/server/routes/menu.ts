import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import {
  DELETED,
  postDailyPuzzle,
  postEloGame,
  todaysPostId,
  utcDate,
  type DailyResult,
} from '../core/daily';
import { readState } from '../core/game';
import { closeNow } from '../core/pollVote';
import {
  createOptions,
  DAILY_LIMIT,
  GENERIC,
  MEMBER_POSTS_OFF,
  postUrl,
} from '../core/posts';
import { isModerator, memberPostsAllowed } from '../core/settings';
import { expireClosedVotes } from '../core/privacy';
import { getPost, keys, putPost, type Series } from '../core/store';
import { currentUsername } from '../core/views';

export const menu = new Hono();

/** Shared by "post today's puzzle" and "post a Guess the Elo game now". */
const postNow = async (
  series: Series,
  run: () => Promise<DailyResult>,
  name: string
): Promise<UiResponse> => {
  const date = utcDate(new Date());
  const existing = await todaysPostId(date, series);
  if (existing)
    return {
      showToast: `Today's ${name} is already up.`,
      navigateTo: postUrl(existing),
    };
  // Today's post was deleted: a mod asking for one now gets a replacement.
  const cur = await redis.hGet(keys.dates(series), date);
  if (cur?.startsWith(DELETED)) await redis.hDel(keys.dates(series), [date]);
  const res = await run();
  if (res.status === 'posted')
    return {
      showToast: {
        text: `Posted ${name} #${res.number}`,
        appearance: 'success',
      },
      navigateTo: postUrl(res.postId),
    };
  if (res.status === 'exists')
    return {
      showToast: `Today's ${name} is being posted. Try again in a minute.`,
      ...(res.postId ? { navigateTo: postUrl(res.postId) } : {}),
    };
  return { showToast: GENERIC };
};

menu.post('/daily-post', async (c) =>
  c.json<UiResponse>(
    await postNow('daily', () => postDailyPuzzle(), 'Daily Puzzle')
  )
);

menu.post('/elo-post', async (c) =>
  c.json<UiResponse>(await postNow('elo', () => postEloGame(), 'Guess the Elo'))
);

// ---- member menu items (everyone): same rules as the in-app "+" sheet ----

const LINK_HELP = 'A lichess.org game link, or a PGN.';

/** Show `form` if this user may make a member post now; else a toast. */
const memberForm = async (
  form: NonNullable<UiResponse['showForm']>
): Promise<UiResponse> => {
  const username = await currentUsername();
  if (!username) return { showToast: 'Log in first.' };
  const opts = await createOptions(username, await isModerator(username));
  if (opts.remainingToday > 0) return { showForm: form };
  return {
    showToast: (await memberPostsAllowed()) ? DAILY_LIMIT : MEMBER_POSTS_OFF,
  };
};

menu.post('/poll-new', async (c) =>
  c.json<UiResponse>(
    await memberForm({
      name: 'pollForm',
      form: {
        title: 'New move poll',
        description: 'Posts as you.',
        acceptLabel: 'Post',
        fields: [
          {
            type: 'paragraph',
            name: 'position',
            label: 'Position',
            helpText:
              'A FEN, a PGN (uses the final position) or a lichess.org analysis link.',
            required: true,
            lineHeight: 4,
          },
          {
            type: 'string',
            name: 'prompt',
            label: 'Question (optional)',
            placeholder: 'White to play',
          },
          {
            type: 'number',
            name: 'closeHours',
            label: 'Close after (hours)',
            helpText: '0 = never. Up to 168.',
            defaultValue: 24,
          },
        ],
      },
    })
  )
);

menu.post('/review-new', async (c) =>
  c.json<UiResponse>(
    await memberForm({
      name: 'reviewForm',
      form: {
        title: 'Review a chess game',
        description: 'Posts as you.',
        acceptLabel: 'Post',
        fields: [
          {
            type: 'paragraph',
            name: 'game',
            label: 'Game',
            helpText: LINK_HELP,
            required: true,
            lineHeight: 6,
          },
          { type: 'paragraph', name: 'caption', label: 'Caption (optional)' },
        ],
      },
    })
  )
);

menu.post('/elo-new', async (c) =>
  c.json<UiResponse>(
    await memberForm({
      name: 'eloForm',
      form: {
        title: 'Guess my Elo',
        description:
          'Posts as you. Player names are removed. A pasted PGN needs WhiteElo and BlackElo.',
        acceptLabel: 'Post',
        fields: [
          {
            type: 'paragraph',
            name: 'game',
            label: 'Game',
            helpText: LINK_HELP,
            required: true,
            lineHeight: 6,
          },
          { type: 'paragraph', name: 'caption', label: 'Caption (optional)' },
        ],
      },
    })
  )
);

// ---- community game (mods) ----

menu.post('/game-start', async (c) => {
  const state = await readState();
  if (state?.openPostId)
    return c.json<UiResponse>({
      showToast: 'A community game is already running.',
      navigateTo: postUrl(state.openPostId),
    });
  return c.json<UiResponse>({
    showForm: {
      name: 'gameStartForm',
      form: {
        title: 'Start a community game',
        description:
          'The subreddit plays both sides. Move 1 goes up now, then one voted move a day at the posting hour.',
        acceptLabel: 'Start',
        fields: [],
      },
    },
  });
});

menu.post('/game-end', async (c) => {
  const state = await readState();
  if (!state?.openPostId)
    return c.json<UiResponse>({ showToast: 'No community game is running.' });
  return c.json<UiResponse>({
    showForm: {
      name: 'gameEndForm',
      form: {
        title: 'End the community game?',
        description: 'Voting stops and no more moves are posted.',
        acceptLabel: 'End game',
        fields: [],
      },
    },
  });
});

menu.post('/poll-close', async (c) => {
  const { postId } = context;
  const post = postId ? await getPost(postId) : null;
  if (!postId || post?.kind !== 'poll')
    return c.json<UiResponse>({ showToast: 'This is not a poll.' });
  await putPost(postId, closeNow(post));
  await expireClosedVotes(keys.votes(postId), Date.now());
  return c.json<UiResponse>({
    showToast: { text: 'Poll closed.', appearance: 'success' },
  });
});
