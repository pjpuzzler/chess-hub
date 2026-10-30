// Member and moderator posts: polls, game reviews, Guess my Elo. Members share
// one daily limit; failures never count against it.
import { context, reddit, redis } from '@devvit/web/server';
import type { CreateOptions, PostData } from '../../shared/api';
import { hasLegalMoves, parsePosition } from '../../shared/chess/poll';
import { displayName } from '../../shared/chess/names';
import { parseGame } from '../../shared/chess/review';
import { fetchLichessPgn, lichessGameId, looksLikeLichessUrl } from './lichess';
import { touchUser } from './privacy';
import { isModerator, memberPostsAllowed } from './settings';
import {
  FEED_STYLES,
  bump,
  cleanText,
  clip,
  keys,
  putPost,
  toInt,
} from './store';

export const MAX_PGN_CHARS = 100_000;
const MAX_TITLE = 300;
export const MAX_PROMPT = 200;
export const MAX_CAPTION = 500;
export const MAX_CLOSE_HOURS = 168;
// Feed card copies (postData is capped at 2 KB): longer text is cut there
// only; the card's text lines clip long text anyway.
const CARD_NAME = 40;
const CARD_CAPTION = 140;
export const MEMBER_POSTS_PER_DAY = 5;
const UNLIMITED = 99;
export const GENERIC = 'Something went wrong. Try again.';
export const MEMBER_POSTS_OFF = 'Member posts are off in this community.';
export const DAILY_LIMIT = `You can make ${MEMBER_POSTS_PER_DAY} posts a day. Try again tomorrow.`;

export type CreateResult =
  { ok: true; postId: string } | { ok: false; error: string };

export const postUrl = (postId: string): string =>
  `https://www.reddit.com/r/${context.subredditName}/comments/${postId.replace(/^t3_/, '')}`;

const sideLabel = (s: 'white' | 'black') => (s === 'white' ? 'White' : 'Black');

// ------------------------------------------------------------ member quota ----

const dayKey = (username: string, now: Date) =>
  keys.memberDaily(username, now.toISOString().slice(0, 10));

export const createOptions = async (
  username: string | null,
  // May be a pending check: the member reads run alongside it.
  isMod: boolean | Promise<boolean>,
  now: Date = new Date()
): Promise<CreateOptions> => {
  if (!username)
    return { review: false, elo: false, poll: false, remainingToday: 0 };
  const [mod, allowed, usedRaw] = await Promise.all([
    isMod,
    memberPostsAllowed(),
    redis.get(dayKey(username, now)),
  ]);
  if (mod)
    return { review: true, elo: true, poll: true, remainingToday: UNLIMITED };
  const used = toInt(usedRaw);
  const remainingToday = allowed ? Math.max(0, MEMBER_POSTS_PER_DAY - used) : 0;
  const can = remainingToday > 0;
  return { review: can, elo: can, poll: can, remainingToday };
};

/**
 * Run `post` under the member quota: mods are unlimited; members need the
 * `memberPosts` setting and a free slot. A failed post gives the slot back.
 */
export const asMemberPost = async (
  username: string,
  post: () => Promise<CreateResult>,
  now: Date = new Date()
): Promise<CreateResult> => {
  if (await isModerator(username)) return post();
  if (!(await memberPostsAllowed()))
    return { ok: false, error: MEMBER_POSTS_OFF };
  const key = dayKey(username, now);
  const n = await bump(key, 2 * 86400);
  if (n > MEMBER_POSTS_PER_DAY) {
    await redis.incrBy(key, -1);
    return { ok: false, error: DAILY_LIMIT };
  }
  let res: CreateResult;
  try {
    res = await post();
  } catch (e) {
    await redis.incrBy(key, -1).catch(() => undefined);
    throw e;
  }
  if (!res.ok) await redis.incrBy(key, -1);
  return res;
};

/** Submit as the user (Devvit posts as the app until the app is approved). */
export const submitAsUser = async (opts: {
  title: string;
  postData: PostData;
  fallback: string;
  ugc: string;
}): Promise<CreateResult> => {
  // No fallback to the app on errors: that would dodge sub bans and spam
  // filters and could double-post on a timeout.
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: opts.title.slice(0, MAX_TITLE),
      postData: opts.postData,
      textFallback: { text: opts.fallback },
      styles: FEED_STYLES,
      runAs: 'USER',
      userGeneratedContent: {
        text: opts.ugc.slice(0, MAX_TITLE + MAX_CAPTION),
      },
    });
    return { ok: true, postId: post.id };
  } catch (e) {
    console.error(`submit as user failed: ${e}`);
    return {
      ok: false,
      error: "Reddit didn't accept the post. Try again later.",
    };
  }
};

/** PGN from a pasted PGN or a lichess.org game link. */
// Lichess fetches per user per hour (shared with /api/game/fetch; never refunded).
export const FETCHES_PER_HOUR = 20;

/** Count a Lichess fetch for a user; false when over the hourly limit. */
export const allowFetch = async (username: string) =>
  (await bump(keys.gameFetches(username), 3600)) <= FETCHES_PER_HOUR;

export const resolvePgn = async (
  input: string,
  username: string
): Promise<{ pgn: string; fromLichess: boolean } | { error: string }> => {
  const text = input.trim();
  if (!text) return { error: 'Paste a PGN or a lichess.org game link.' };
  if (text.length > MAX_PGN_CHARS) return { error: 'That PGN is too long.' };
  const id = lichessGameId(text);
  if (id) {
    if (!(await allowFetch(username)))
      return { error: 'Slow down a little and try again.' };
    const got = await fetchLichessPgn(id);
    return 'error' in got ? got : { pgn: got.pgn, fromLichess: true };
  }
  if (looksLikeLichessUrl(text))
    return {
      error: 'Use a link to a lichess.org game, like lichess.org/abcd1234.',
    };
  return { pgn: text, fromLichess: false };
};

// ------------------------------------------------------------------- polls ----

export type PollInput = {
  position: string;
  prompt: string;
  closeHours: number;
  orientation: 'auto' | 'white' | 'black';
  // Overrides the last move taken from a PGN (null = none).
  lastMove?: string | null;
  // Post as the requesting user (in-app) rather than the app (mod menu).
  asUser?: boolean;
};

export const createPollPost = async (
  input: PollInput,
  now: Date = new Date()
): Promise<CreateResult> => {
  if (input.position.length > MAX_PGN_CHARS)
    return { ok: false, error: 'That PGN is too long.' };
  const parsed = parsePosition(input.position);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  if (!hasLegalMoves(parsed.fen))
    return { ok: false, error: 'The game is over in that position.' };
  if (
    !Number.isFinite(input.closeHours) ||
    input.closeHours < 0 ||
    input.closeHours > MAX_CLOSE_HOURS
  )
    return {
      ok: false,
      error: `Close after 0 (never) to ${MAX_CLOSE_HOURS} hours.`,
    };
  const typed = cleanText(input.prompt, 10_000);
  if (typed.length > MAX_PROMPT)
    return {
      ok: false,
      error: `Keep the question under ${MAX_PROMPT} characters.`,
    };
  if (
    input.lastMove != null &&
    (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(input.lastMove) ||
      input.lastMove.slice(0, 2) === input.lastMove.slice(2, 4))
  )
    return { ok: false, error: GENERIC };

  const toPlay = `${sideLabel(parsed.turn)} to play`;
  const prompt = typed || toPlay;
  // The in-app form pre-fills "White to play": don't repeat it in the title.
  const question = typed.replace(/[.!?\s]+$/, '');
  const title =
    !question || question.toLowerCase() === toPlay.toLowerCase()
      ? `What's the move? · ${toPlay}`
      : /\b(white|black) to (play|move)\b/i.test(question)
        ? typed
        : `${typed} · ${toPlay}`;
  const orientation =
    input.orientation === 'auto' ? parsed.turn : input.orientation;
  const closesAt =
    input.closeHours > 0
      ? now.getTime() + Math.round(input.closeHours * 3_600_000)
      : null;
  const postData: PostData = {
    kind: 'poll',
    fen: parsed.fen,
    orientation,
    card: { kind: 'poll', prompt },
  };
  const fallback = `${title}. FEN: ${parsed.fen}`;

  let res: CreateResult;
  if (input.asUser) {
    res = await submitAsUser({ title, postData, fallback, ugc: title });
  } else {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: title.slice(0, MAX_TITLE),
      postData,
      textFallback: { text: fallback },
      styles: FEED_STYLES,
    });
    res = { ok: true, postId: post.id };
  }
  if (!res.ok) return res;
  await putPost(res.postId, {
    kind: 'poll',
    fen: parsed.fen,
    prompt,
    lastMove: input.lastMove === undefined ? parsed.lastMove : input.lastMove,
    closesAt,
  });
  return res;
};

// ----------------------------------------------------------------- reviews ----

export type ReviewInput = { pgnOrUrl: string; caption: string };

export const createReviewPost = async (
  input: ReviewInput,
  username: string
): Promise<CreateResult> => {
  const src = await resolvePgn(input.pgnOrUrl, username);
  if ('error' in src) return { ok: false, error: src.error };
  const game = parseGame(src.pgn);
  if ('error' in game) return { ok: false, error: game.error };

  const caption = cleanText(input.caption, MAX_CAPTION);
  const title = `Game review: ${displayName(game.white)} vs ${displayName(game.black)} (${game.result})`;
  const res = await submitAsUser({
    title,
    postData: {
      kind: 'review',
      fen: game.fens[game.fens.length - 1] ?? game.startFen,
      orientation: 'white',
      card: {
        kind: 'review',
        white: clip(game.white, CARD_NAME),
        black: clip(game.black, CARD_NAME),
        result: game.result,
        caption: clip(caption, CARD_CAPTION),
        game: null,
      },
    },
    fallback: caption ? `${title}. ${caption}` : title,
    ugc: caption ? `${title}\n${caption}` : title,
  });
  if (!res.ok) return res;
  await putPost(res.postId, {
    kind: 'review',
    pgn: game.pgn,
    white: game.white,
    black: game.black,
    result: game.result,
    caption,
    author: username,
  });
  await touchUser(username, { postId: res.postId, authored: true });
  return res;
};
