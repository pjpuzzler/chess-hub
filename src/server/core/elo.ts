// Guess the Elo: curated games (scheduled) and members' own games.
import { redis } from '@devvit/web/server';
import type { EloGuessResponse, EloReveal, EloView } from '../../shared/api';
import { parseGame } from '../../shared/chess/review';
import { movetextOnly, utcDate } from './daily';
import { isBanned, MIN_ELO_GAMES } from './leaderboard';
import { touchUser } from './privacy';
import {
  MAX_CAPTION,
  resolvePgn,
  submitAsUser,
  type CreateResult,
} from './posts';
import { cleanText, keys, putPost, toInt, type StoredEloPost } from './store';

export const MIN_GUESS = 400;
export const MAX_GUESS = 3000;
export const GUESS_STEP = 25;
const MIN_RATING = 100;
const MAX_RATING = 3500;
const MIN_PLIES = 20; // 10 full moves
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const isValidGuess = (g: unknown): g is number =>
  typeof g === 'number' &&
  Number.isInteger(g) &&
  g >= MIN_GUESS &&
  g <= MAX_GUESS &&
  g % GUESS_STEP === 0;

export const average = (p: StoredEloPost) =>
  Math.round((p.white + p.black) / 2);

/**
 * Score 0-100: 100 for an exact guess, minus a point per 10 rating points
 * off, floored at 0 (so 1000+ off scores nothing).
 */
export const eloScore = (guess: number, avg: number): number =>
  Math.max(0, Math.round(100 - Math.abs(guess - avg) / 10));

const bucketOf = (g: number) => Math.floor(g / 100) * 100;

export const getReveal = async (
  postId: string,
  post: StoredEloPost
): Promise<EloReveal> => {
  const raw = await redis.hGetAll(keys.eloHist(postId)); // <= 27 fields
  const histogram = Object.entries(raw)
    .map(([b, c]) => ({ bucket: toInt(b), count: toInt(c) }))
    .filter((h) => h.count > 0)
    .sort((a, b) => a.bucket - b.bucket);
  return {
    white: post.white,
    black: post.black,
    average: average(post),
    histogram,
    totalGuesses: histogram.reduce((s, h) => s + h.count, 0),
  };
};

const userTotals = async (username: string) => {
  const [t, g] = await Promise.all([
    redis.hGet(keys.user(username), 'eloTotal'),
    redis.hGet(keys.user(username), 'eloGames'),
  ]);
  return { totalScore: toInt(t), games: toInt(g) };
};

export const buildEloView = async (
  postId: string,
  post: StoredEloPost,
  username: string | null
): Promise<EloView> => {
  const mine = username
    ? await redis.hGet(keys.eloGuesses(postId), username)
    : undefined;
  const myGuess = mine === undefined ? null : toInt(mine);
  const canSee =
    myGuess !== null || (username !== null && username === post.author);
  return {
    kind: 'elo',
    source: post.source,
    author: post.author,
    caption: post.caption,
    number: post.number,
    game: post.game,
    myGuess,
    myScore: myGuess === null ? null : eloScore(myGuess, average(post)),
    reveal: canSee ? await getReveal(postId, post) : null,
    me: username ? await userTotals(username) : null,
  };
};

export type GuessOutcome =
  | { ok: true; response: EloGuessResponse }
  | { ok: false; status: 409; message: string };

/** One final guess per user; hSetNX is the atomic gate. */
export const castGuess = async (
  username: string,
  postId: string,
  post: StoredEloPost,
  guess: number
): Promise<GuessOutcome> => {
  if (post.author === username)
    return { ok: false, status: 409, message: 'You posted this game.' };
  await touchUser(username, { postId });
  if (
    (await redis.hSetNX(keys.eloGuesses(postId), username, String(guess))) !== 1
  )
    return { ok: false, status: 409, message: 'You already guessed.' };

  const avg = average(post);
  const err = Math.abs(guess - avg);
  const score = eloScore(guess, avg);
  // Errors take few distinct values (guesses are on a 25-pt grid), so this
  // hash stays small.
  const errs = await redis.hGetAll(keys.eloErrors(postId));
  let earlier = 0;
  let worse = 0;
  for (const [e, c] of Object.entries(errs)) {
    earlier += toInt(c);
    if (toInt(e) > err) worse += toInt(c);
  }
  // Nobody to beat yet counts as the top.
  const percentile = earlier === 0 ? 100 : Math.round((100 * worse) / earlier);
  await Promise.all([
    redis.hIncrBy(keys.eloErrors(postId), String(err), 1),
    redis.hIncrBy(keys.eloHist(postId), String(bucketOf(guess)), 1),
  ]);
  const total = await redis.hIncrBy(keys.user(username), 'eloTotal', score);
  const games = await redis.hIncrBy(keys.user(username), 'eloGames', 1);
  if (games >= MIN_ELO_GAMES && !(await isBanned(username))) {
    const lb = keys.leaderboard('elo');
    if (games === MIN_ELO_GAMES)
      await redis.zAdd(lb, { member: username, score: total });
    else await redis.zIncrBy(lb, username, score);
  }
  await touchUser(username, { postId }); // sets the TTL on the new totals
  return {
    ok: true,
    response: {
      type: 'eloGuess',
      myGuess: guess,
      myScore: score,
      reveal: await getReveal(postId, post),
      percentile,
    },
  };
};

export type EloCreateInput = { pgnOrUrl: string; caption: string };

/** A member's own game. Names, comments and headers are stripped. */
export const createEloMemberPost = async (
  input: EloCreateInput,
  username: string,
  now: Date = new Date()
): Promise<CreateResult> => {
  const src = await resolvePgn(input.pgnOrUrl, username);
  if ('error' in src) return { ok: false, error: src.error };
  const game = parseGame(src.pgn);
  if ('error' in game) return { ok: false, error: game.error };
  if (
    game.startFen !== START ||
    (game.tags['Variant'] ?? 'Standard') !== 'Standard'
  )
    return {
      ok: false,
      error: 'Use a standard game from the normal starting position.',
    };
  if (game.moves.length < MIN_PLIES)
    return { ok: false, error: 'Use a game with at least 10 moves each.' };
  const white = Number(game.tags['WhiteElo']);
  const black = Number(game.tags['BlackElo']);
  const ok = (r: number) =>
    Number.isInteger(r) && r >= MIN_RATING && r <= MAX_RATING;
  if (src.fromLichess && !/\brated\b/i.test(game.tags['Event'] ?? ''))
    return { ok: false, error: 'Only rated Lichess games can be used.' };
  if (!ok(white) || !ok(black))
    return {
      ok: false,
      error: src.fromLichess
        ? 'That Lichess game has no ratings.'
        : 'Add WhiteElo and BlackElo to the PGN (100 to 3500).',
    };

  const caption = cleanText(input.caption, MAX_CAPTION);
  const title = caption
    ? `Guess the Elo: ${caption}`.slice(0, 120)
    : 'Guess my Elo';
  const res = await submitAsUser({
    title,
    postData: {
      kind: 'elo',
      fen: game.fens[game.fens.length - 1] ?? game.startFen,
      orientation: 'white',
    },
    fallback: `${title}: guess the players' average rating.`,
    ugc: caption ? `${title}\n${caption}` : title,
  });
  if (!res.ok) return res;
  await putPost(res.postId, {
    kind: 'elo',
    number: 0,
    date: utcDate(now),
    game: {
      pgn: movetextOnly(game.pgn),
      timeControl: cleanText(game.tags['TimeControl'] ?? '-', 20) || '-',
      result: game.result,
    },
    white,
    black,
    source: src.fromLichess ? 'lichess' : 'selfReported',
    author: username,
    caption,
  });
  await touchUser(username, { postId: res.postId, authored: true });
  return res;
};
