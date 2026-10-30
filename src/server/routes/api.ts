import { Hono } from 'hono';
import type { Context } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  EloCreateResponse,
  EloGuessResponse,
  ErrorResponse,
  GameFetchResponse,
  GameVoteResponse,
  InitResponse,
  LeaderboardKind,
  LeaderboardRemoveResponse,
  LeaderboardResponse,
  PollCreateResponse,
  PollVoteResponse,
  PuzzleHintResponse,
  PuzzleMoveResponse,
  PuzzleRevealResponse,
  ReviewAnalysisResponse,
  ReviewCreateResponse,
  ReviewResetResponse,
} from '../../shared/api';
import { castGameVote, getPostHealed } from '../core/game';
import { castGuess, createEloMemberPost, isValidGuess } from '../core/elo';
import { fetchLichessPgn, lichessGameId } from '../core/lichess';
import { getLeaderboard, removeFromLeaderboards } from '../core/leaderboard';
import { castVote } from '../core/pollVote';
import {
  allowFetch,
  asMemberPost,
  createOptions,
  createPollPost,
  createReviewPost,
  GENERIC,
  MAX_CAPTION,
  MAX_PGN_CHARS,
  postUrl,
} from '../core/posts';
import {
  getStats,
  markTiming,
  markViewed,
  publicPuzzle,
  recordEvent,
} from '../core/puzzle';
import { checkLine, nextMove } from '../core/puzzleCheck';
import { resetAnalysis, submitAnalysis } from '../core/review';
import { isAnarchy, isModerator } from '../core/settings';
import { bump, getPost, keys, type StoredPuzzlePost } from '../core/store';
import { buildView, currentUsername } from '../core/views';

export const api = new Hono();

type Status = 400 | 401 | 403 | 404 | 409 | 429;
const fail = (c: Context, status: Status, message: string) =>
  c.json<ErrorResponse>({ type: 'error', message }, status);

const LOGIN = 'Log in to do that.';
const GONE = 'This post is no longer available.';
// Move + hint calls per user per puzzle per hour (a puzzle has <= 5 moves).
const PUZZLE_CALLS_PER_HOUR = 120;

const readBody = async (c: Context): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await c.req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body))
      : {};
  } catch {
    return {};
  }
};

const isMoveList = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 10 &&
  v.every((m) => typeof m === 'string' && m.length <= 5);

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const post = await getPostHealed(postId);
  if (!post) return fail(c, 404, GONE);
  const username = await currentUsername();
  const canModerate = username ? await isModerator(username) : false;
  if (post.kind === 'puzzle' && username) await markViewed(postId, username);
  const [view, create, anarchy] = await Promise.all([
    buildView(postId, post, username, Date.now(), canModerate),
    createOptions(username, canModerate),
    isAnarchy(),
  ]);
  return c.json<InitResponse>({
    type: 'init',
    postId,
    username,
    post: view,
    flags: { anarchy },
    canModerate,
    create,
  });
});

// ------------------------------------------------------------------ puzzle ----

const puzzleContext = async (c: Context, requireLogin: boolean) => {
  const { postId } = context;
  if (!postId) return { error: fail(c, 400, GENERIC) };
  const post = await getPost(postId);
  if (post?.kind !== 'puzzle') return { error: fail(c, 404, GONE) };
  // Hints and reveal need login (they hand out solution moves). Logged-out
  // viewers may play moves but only ever learn right or wrong.
  const username = await currentUsername();
  if (!username) {
    if (requireLogin) return { error: fail(c, 401, 'Log in to solve.') };
    return { postId, post, username: null };
  }
  const n = await bump(keys.puzzleCalls(postId, username), 3600);
  if (n > PUZZLE_CALLS_PER_HOUR)
    return { error: fail(c, 429, 'Slow down a little and try again.') };
  return { postId, post, username };
};

const finished = (p: StoredPuzzlePost) => publicPuzzle(p.puzzle, true);

api.post('/puzzle/move', async (c) => {
  const ctx = await puzzleContext(c, false);
  if ('error' in ctx) return ctx.error;
  const { postId, post, username } = ctx;
  const { moves } = await readBody(c);
  if (!isMoveList(moves)) return fail(c, 400, GENERIC);
  const check = checkLine(post.puzzle, moves);
  if (check.kind === 'invalid') return fail(c, 400, GENERIC);

  const done = check.kind === 'correct' && check.done;
  const event = check.kind === 'wrong' ? 'wrong' : done ? 'solved' : null;
  if (username)
    await markTiming(postId, username, check.kind === 'correct' && check.done);
  const rec =
    username && event ? await recordEvent(username, postId, post, event) : null;
  // The full line and themes are for logged-in finishers only.
  const full = done && username ? finished(post) : null;
  return c.json<PuzzleMoveResponse>({
    type: 'puzzleMove',
    correct: check.kind === 'correct',
    reply: check.kind === 'correct' ? check.reply : null,
    done,
    me: rec?.me ?? null,
    stats: rec?.stats ?? (await getStats(postId)),
    ratingDelta: rec?.ratingDelta ?? 0,
    solution: full?.solution ?? null,
    themes: full?.themes ?? null,
  });
});

api.post('/puzzle/hint', async (c) => {
  const ctx = await puzzleContext(c, true);
  if ('error' in ctx) return ctx.error;
  const { postId, post, username } = ctx;
  const { moves } = await readBody(c);
  if (!isMoveList(moves)) return fail(c, 400, GENERIC);
  const move = nextMove(post.puzzle, moves);
  if (!move) return fail(c, 400, GENERIC);
  if (!username) return fail(c, 401, 'Log in to solve.');
  await recordEvent(username, postId, post, 'hint');
  return c.json<PuzzleHintResponse>({ type: 'puzzleHint', move });
});

api.post('/puzzle/reveal', async (c) => {
  const ctx = await puzzleContext(c, true);
  if ('error' in ctx) return ctx.error;
  const { postId, post, username } = ctx;
  if (!username) return fail(c, 401, 'Log in to solve.');
  const rec = await recordEvent(username, postId, post, 'reveal');
  const full = finished(post);
  return c.json<PuzzleRevealResponse>({
    type: 'puzzleReveal',
    solution: full.solution ?? [],
    themes: full.themes ?? [],
    me: rec.me,
    stats: rec.stats,
    ratingDelta: rec.ratingDelta,
  });
});

// -------------------------------------------------------------------- poll ----

api.post('/poll/vote', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  if (!username) return fail(c, 401, 'Log in to vote.');
  const post = await getPost(postId);
  if (post?.kind !== 'poll') return fail(c, 404, GONE);
  const { move } = await readBody(c);
  if (typeof move !== 'string') return fail(c, 400, GENERIC);
  const out = await castVote(username, postId, post, move);
  if (!out.ok) return fail(c, out.status, out.message);
  return c.json<PollVoteResponse>(out.response);
});

api.post('/poll/create', async (c) => {
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  const { fen, prompt, closeHours, lastMove } = await readBody(c);
  if (
    typeof fen !== 'string' ||
    typeof prompt !== 'string' ||
    typeof closeHours !== 'number' ||
    (lastMove !== undefined &&
      lastMove !== null &&
      typeof lastMove !== 'string')
  )
    return fail(c, 400, GENERIC);
  const res = await asMemberPost(username, () =>
    createPollPost({
      position: fen,
      prompt,
      closeHours,
      orientation: 'auto',
      lastMove: lastMove ?? null,
      asUser: true,
    })
  );
  if (!res.ok) return fail(c, 400, res.error);
  return c.json<PollCreateResponse>({
    type: 'pollCreate',
    postId: res.postId,
    url: postUrl(res.postId),
  });
});

// ------------------------------------------------------------------ review ----

const readCreate = async (c: Context) => {
  const { pgnOrUrl, caption } = await readBody(c);
  if (
    typeof pgnOrUrl !== 'string' ||
    (caption !== undefined && typeof caption !== 'string')
  )
    return null;
  if (
    pgnOrUrl.length > MAX_PGN_CHARS ||
    (caption ?? '').length > MAX_CAPTION * 4
  )
    return null;
  return { pgnOrUrl, caption: caption ?? '' };
};

api.post('/review/create', async (c) => {
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  const input = await readCreate(c);
  if (!input) return fail(c, 400, GENERIC);
  const res = await asMemberPost(username, () =>
    createReviewPost(input, username)
  );
  if (!res.ok) return fail(c, 400, res.error);
  return c.json<ReviewCreateResponse>({
    type: 'reviewCreate',
    postId: res.postId,
    url: postUrl(res.postId),
  });
});

api.post('/review/analysis', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  if (!username) return fail(c, 401, 'Log in to analyze this game.');
  const post = await getPost(postId);
  if (post?.kind !== 'review') return fail(c, 404, GONE);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, GENERIC);
  }
  const out = await submitAnalysis(postId, post, username, body);
  if (!out.ok) return fail(c, out.status, out.message);
  return c.json<ReviewAnalysisResponse>({
    type: 'reviewAnalysis',
    analysis: out.analysis,
  });
});

api.post('/review/reset', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  const post = await getPost(postId);
  if (post?.kind !== 'review') return fail(c, 404, GONE);
  if (username !== post.author && !(await isModerator(username)))
    return fail(c, 403, 'Only the author or a moderator can do that.');
  await resetAnalysis(postId);
  return c.json<ReviewResetResponse>({ type: 'reviewReset' });
});

// --------------------------------------------------------------------- elo ----

api.post('/elo/guess', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  if (!username) return fail(c, 401, 'Log in to guess.');
  const post = await getPost(postId);
  if (post?.kind !== 'elo') return fail(c, 404, GONE);
  const { guess } = await readBody(c);
  if (!isValidGuess(guess)) return fail(c, 400, GENERIC);
  const out = await castGuess(username, postId, post, guess);
  if (!out.ok) return fail(c, out.status, out.message);
  return c.json<EloGuessResponse>(out.response);
});

api.post('/elo/create', async (c) => {
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  const input = await readCreate(c);
  if (!input) return fail(c, 400, GENERIC);
  const res = await asMemberPost(username, () =>
    createEloMemberPost(input, username)
  );
  if (!res.ok) return fail(c, 400, res.error);
  return c.json<EloCreateResponse>({
    type: 'eloCreate',
    postId: res.postId,
    url: postUrl(res.postId),
  });
});

// ---------------------------------------------------------- community game ----

api.post('/game/vote', async (c) => {
  const { postId } = context;
  if (!postId) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  if (!username) return fail(c, 401, 'Log in to vote.');
  const post = await getPostHealed(postId);
  if (post?.kind !== 'game') return fail(c, 404, GONE);
  const { move } = await readBody(c);
  if (typeof move !== 'string') return fail(c, 400, GENERIC);
  const out = await castGameVote(username, postId, post, move);
  if (!out.ok) return fail(c, out.status, out.message);
  return c.json<GameVoteResponse>(out.response);
});

// -------------------------------------------------------------- game fetch ----

api.post('/game/fetch', async (c) => {
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  const { url } = await readBody(c);
  const id =
    typeof url === 'string' && url.length < 300 ? lichessGameId(url) : null;
  if (!id)
    return fail(
      c,
      400,
      'Use a link to a lichess.org game, like lichess.org/abcd1234.'
    );
  if (!(await allowFetch(username)))
    return fail(c, 429, 'Slow down a little and try again.');
  const got = await fetchLichessPgn(id);
  if ('error' in got) return fail(c, 400, got.error);
  return c.json<GameFetchResponse>({ type: 'gameFetch', pgn: got.pgn });
});

// ------------------------------------------------------------- leaderboard ----

const isKind = (v: string | undefined): v is LeaderboardKind =>
  v === 'streak' || v === 'rating' || v === 'solved' || v === 'elo';

api.get('/leaderboard', async (c) => {
  const kind = c.req.query('kind');
  if (!isKind(kind)) return fail(c, 400, GENERIC);
  const username = await currentUsername();
  return c.json<LeaderboardResponse>(await getLeaderboard(kind, username));
});

api.post('/leaderboard/remove', async (c) => {
  const username = await currentUsername();
  if (!username) return fail(c, 401, LOGIN);
  if (!(await isModerator(username)))
    return fail(c, 403, 'Only moderators can do that.');
  const { username: target } = await readBody(c);
  const name =
    typeof target === 'string' ? target.trim().replace(/^\/?u\//i, '') : '';
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(name))
    return fail(c, 400, "That isn't a Reddit username.");
  // Leaderboards store Reddit's canonical casing.
  let canonical = name;
  try {
    canonical = (await reddit.getUserByUsername(name))?.username ?? name;
  } catch {
    // Unknown or suspended accounts: use the name as typed.
  }
  await removeFromLeaderboards(canonical, username);
  return c.json<LeaderboardRemoveResponse>({ type: 'leaderboardRemove' });
});
