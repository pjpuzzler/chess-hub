// Mock of `@devvit/web/client` for the local harness. vite.config.ts aliases
// the real package to this file only in `--mode mock`. It also installs a
// fetch shim that answers /api/* from fixtures, chosen by `?fixture=<name>`
// (and optional `&latency=<ms>`, default 350).
import { Chess } from 'chess.js';
import type {
  ErrorResponse,
  InitResponse,
  LeaderboardKind,
  LeaderboardResponse,
  PuzzleMe,
} from '../../shared/api';
import { fenAtPly, stepPuzzle } from '../../shared/chess/puzzle';
import { parseGame, validateAnalysis } from '../../shared/chess/review';
import {
  FIXTURES,
  GAME_FETCH_PGN,
  LEADERBOARD,
  MOD,
  type Fixture,
} from './fixtures';

const params = new URLSearchParams(location.search);
const fixtureName = params.get('fixture') ?? 'puzzle';
const latency = Number(params.get('latency') ?? 350);
const fallback = FIXTURES.puzzle;
if (!fallback) throw new Error('missing puzzle fixture');
const fixture: Fixture = FIXTURES[fixtureName] ?? fallback;

export const context = {
  postId: 't3_mock',
  postData: fixture.postData,
  username: fixture.username ?? undefined,
  userId: fixture.username ? 't2_mock' : undefined,
  subredditName: 'chess_hub_dev',
  appSlug: 'chess-hub',
};

// ---------- client effects ----------

function toastHost(): HTMLElement {
  let host = document.getElementById('mock-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mock-toasts';
    host.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none';
    document.body.append(host);
  }
  return host;
}

export function showToast(toast: string | { text: string }): void {
  const el = document.createElement('div');
  el.textContent = typeof toast === 'string' ? toast : toast.text;
  el.style.cssText =
    'background:#1c1c1c;color:#fff;padding:10px 16px;border-radius:999px;font:500 14px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  toastHost().append(el);
  setTimeout(() => el.remove(), 2600);
}

export function navigateTo(url: string | { url: string }): void {
  showToast(`[mock] navigateTo ${typeof url === 'string' ? url : url.url}`);
}

export function navigateToPost(postId: string): void {
  showToast(`[mock] navigateToPost ${postId}`);
}

export async function showShareSheet(opts: {
  text?: string;
  title?: string;
}): Promise<void> {
  showToast(`[mock] share sheet: ${opts.text ?? ''}`);
}

export function showLoginPrompt(): void {
  showToast('[mock] Reddit login prompt');
}

export function getWebViewMode(): 'inline' | 'expanded' {
  return location.pathname.endsWith('game.html') ? 'expanded' : 'inline';
}

export function requestExpandedMode(event: MouseEvent, entry: string): void {
  if (!event.isTrusted)
    throw new Error('requestExpandedMode needs a trusted event');
  if (entry !== 'game') throw new Error(`unknown entry ${entry}`);
  // Inline posts are iframes in the harness index; open the game in the top window.
  const target = window.top ?? window;
  target.location.href = `/game.html${location.search}`;
}

export function exitExpandedMode(): void {
  history.back();
}

// ---------- /api fixture server ----------
// Behaves like the real server closely enough to play every flow: puzzle
// moves are checked against a secret line, results show after voting, etc.

type MockResponse = { status: number; body: unknown };

// `&mod=1` / `&mod=0` overrides whether the viewer moderates the subreddit.
const modParam = params.get('mod');
const initial: InitResponse | null =
  fixture.init && modParam !== null
    ? {
        ...fixture.init,
        canModerate: modParam === '1',
        ...(modParam === '1' ? { create: MOD } : {}),
      }
    : fixture.init;
let state: InitResponse | null = initial ? structuredClone(initial) : null;
const secret = fixture.secret ?? {};
let hinted = false;
let missed = false;
let removed: string[] = [];

function error(status: number, message: string): MockResponse {
  const body: ErrorResponse = { type: 'error', message };
  return { status, body };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;

// First final result per viewer sets rating and streak, like the server.
function settle(me: PuzzleMe | null, solved: boolean): number {
  if (!me) return 0;
  if (me.status === 'unsolved') {
    const clean = solved && !hinted && !missed;
    const delta = clean ? 11 : -13;
    me.status = solved ? 'solved' : 'failed';
    me.cleanSolve = clean;
    me.rating += delta;
    // Any solve keeps the streak (mistakes and hints too); giving up breaks it.
    me.streak = solved ? me.streak + 1 : 0;
    me.bestStreak = Math.max(me.bestStreak, me.streak);
    if (solved) me.solvedTotal += 1;
    return delta;
  }
  if (me.status === 'failed' && solved) {
    me.status = 'solved';
    me.streak += 1;
  }
  return 0;
}

function puzzleMove(body: unknown): MockResponse {
  if (state?.post.kind !== 'puzzle') return error(404, 'not a puzzle post');
  const line = secret.solution;
  const moves = isRecord(body) ? strings(body.moves) : null;
  if (!line || !moves || moves.length === 0) return error(400, 'bad body');
  const view = state.post;
  const i = moves.length - 1;
  const ply = 2 * i + 1;
  const prefix: string[] = [];
  moves.slice(0, i).forEach((m, k) => prefix.push(line[2 * k] ?? '', m));
  prefix.push(line[ply - 1] ?? '');
  const fenBefore = fenAtPly(view.puzzle.fen, prefix, prefix.length);
  const step = stepPuzzle(line, ply, fenBefore, moves[i] ?? '');
  const firstAttempt = view.me?.status === 'unsolved';
  let ratingDelta = 0;
  let me: PuzzleMe | null = null;
  if (step.kind === 'wrong') {
    if (!missed) {
      missed = true;
      ratingDelta = settle(view.me, false);
      me = view.me ? { ...view.me } : null;
    }
  } else if (step.kind === 'solved') {
    ratingDelta = firstAttempt
      ? settle(view.me, true)
      : (settle(view.me, true), 0);
    me = view.me ? { ...view.me } : null;
    if (firstAttempt && view.me?.cleanSolve) view.stats.cleanSolves += 1;
    if (state.username) {
      view.puzzle.solution = line;
      view.puzzle.themes = secret.themes ?? [];
    }
  }
  if (firstAttempt && me) view.stats.attempts += 1;
  const reveal = step.kind === 'solved' && state.username !== null;
  return {
    status: 200,
    body: {
      type: 'puzzleMove',
      correct: step.kind !== 'wrong',
      reply: step.kind === 'continue' ? step.reply : null,
      done: step.kind === 'solved',
      me,
      stats: { ...view.stats },
      ratingDelta,
      // Logged out: never the solution, and a miss just ends the try.
      solution: reveal ? line : null,
      themes: reveal ? (secret.themes ?? []) : null,
    },
  };
}

function puzzleHint(body: unknown): MockResponse {
  if (!state?.username) return error(401, 'Log in to use hints.');
  const moves = isRecord(body) ? strings(body.moves) : null;
  const move = moves ? secret.solution?.[2 * moves.length + 1] : undefined;
  if (!move) return error(400, 'no hint here');
  hinted = true;
  return { status: 200, body: { type: 'puzzleHint', move } };
}

function puzzleReveal(): MockResponse {
  if (!state?.username) return error(401, 'Log in to see the solution.');
  if (state?.post.kind !== 'puzzle' || !secret.solution)
    return error(404, 'not a puzzle post');
  const view = state.post;
  const first = view.me?.status === 'unsolved';
  const ratingDelta = first ? settle(view.me, false) : 0;
  if (first) view.stats.attempts += 1;
  view.puzzle.solution = secret.solution;
  view.puzzle.themes = secret.themes ?? [];
  return {
    status: 200,
    body: {
      type: 'puzzleReveal',
      solution: secret.solution,
      themes: secret.themes ?? [],
      me: view.me ? { ...view.me } : null,
      stats: { ...view.stats },
      ratingDelta,
    },
  };
}

function pollVote(body: unknown): MockResponse {
  if (state?.post.kind !== 'poll') return error(404, 'not a poll post');
  if (!state.username) return error(401, 'Log in to vote.');
  const move =
    isRecord(body) && typeof body.move === 'string' ? body.move : null;
  if (!move) return error(400, 'bad body');
  const poll = state.post;
  if (params.get('conflict') === '1') {
    // Simulates a vote cast from another device: the server already has one.
    poll.myVote = 'g5f6';
    poll.results = structuredClone(secret.pollResults ?? []);
    return error(409, 'You already voted in this poll.');
  }
  if (poll.myVote) return error(409, 'You already voted in this poll.');
  if (poll.closesAt !== null && poll.closesAt < Date.now()) {
    return error(409, 'This poll has closed.');
  }
  let san: string;
  try {
    san = new Chess(poll.fen).move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      ...(move[4] ? { promotion: move[4] } : {}),
    }).san;
  } catch {
    return error(400, 'That move isn’t legal.');
  }
  const results = poll.results ?? structuredClone(secret.pollResults ?? []);
  const existing = results.find((r) => r.move === move);
  if (existing) existing.votes += 1;
  else results.push({ move, san, votes: 1 });
  results.sort((a, b) => b.votes - a.votes);
  poll.results = results;
  poll.myVote = move;
  poll.totalVotes += 1;
  return {
    status: 200,
    body: {
      type: 'pollVote',
      myVote: move,
      totalVotes: poll.totalVotes,
      results,
    },
  };
}

function gameVote(body: unknown): MockResponse {
  if (state?.post.kind !== 'game') return error(404, 'not a game post');
  if (!state.username) return error(401, 'Log in to vote.');
  const move =
    isRecord(body) && typeof body.move === 'string' ? body.move : null;
  if (!move) return error(400, 'bad body');
  const game = state.post;
  if (game.status !== 'open') return error(409, 'Voting on this move closed.');
  if (game.myVote) return error(409, 'You already voted on this move.');
  let san: string;
  try {
    san = new Chess(game.fen).move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      ...(move[4] ? { promotion: move[4] } : {}),
    }).san;
  } catch {
    return error(400, 'That move isn’t legal.');
  }
  const results = game.results ?? structuredClone(secret.pollResults ?? []);
  const existing = results.find((r) => r.move === move);
  if (existing) existing.votes += 1;
  else results.push({ move, san, votes: 1 });
  results.sort((a, b) => b.votes - a.votes);
  game.results = results;
  game.myVote = move;
  game.totalVotes += 1;
  return {
    status: 200,
    body: {
      type: 'gameVote',
      myVote: move,
      totalVotes: game.totalVotes,
      results,
    },
  };
}

function eloGuess(body: unknown): MockResponse {
  if (state?.post.kind !== 'elo') return error(404, 'not an elo post');
  if (!state.username) return error(401, 'Log in to guess.');
  const guess =
    isRecord(body) && typeof body.guess === 'number' ? body.guess : null;
  const reveal = secret.eloReveal;
  if (guess === null || !reveal) return error(400, 'bad body');
  if (state.post.myGuess !== null) return error(409, 'You already guessed.');
  const err = Math.abs(guess - reveal.average);
  const score = Math.max(0, Math.round(100 - err / 8));
  const bucket = Math.floor(guess / 100) * 100;
  const histogram = [...reveal.histogram];
  const hit = histogram.find((b) => b.bucket === bucket);
  if (hit) hit.count += 1;
  else {
    histogram.push({ bucket, count: 1 });
    histogram.sort((a, b) => a.bucket - b.bucket);
  }
  const next = { ...reveal, histogram, totalGuesses: reveal.totalGuesses + 1 };
  Object.assign(state.post, { myGuess: guess, myScore: score, reveal: next });
  return {
    status: 200,
    body: {
      type: 'eloGuess',
      myGuess: guess,
      myScore: score,
      reveal: next,
      percentile: Math.max(0, Math.min(99, Math.round(100 - err / 6))),
    },
  };
}

// Member posts share one daily allowance.
function createPost(
  kind: 'review' | 'elo' | 'poll',
  body: unknown
): MockResponse {
  if (!state?.username) return error(401, 'Log in first.');
  if (!state.create[kind])
    return error(403, 'Posting that is turned off here.');
  if (state.create.remainingToday <= 0)
    return error(429, 'You’ve posted 5 times today. Try tomorrow.');
  if (!isRecord(body)) return error(400, 'bad body');
  if (kind === 'poll') {
    if (typeof body.fen !== 'string' || typeof body.prompt !== 'string')
      return error(400, 'bad body');
  } else {
    const text = typeof body.pgnOrUrl === 'string' ? body.pgnOrUrl.trim() : '';
    if (!text) return error(400, 'Paste a PGN or a Lichess game link.');
    if (!/lichess\.org\//.test(text) && 'error' in parseGame(text)) {
      return error(400, 'That PGN couldn’t be read.');
    }
    if (
      kind === 'elo' &&
      !/lichess\.org\//.test(text) &&
      !/WhiteElo/.test(text)
    ) {
      return error(
        400,
        'Add WhiteElo and BlackElo to the PGN, or paste a Lichess link.'
      );
    }
  }
  if (state.create.remainingToday < 99) state.create.remainingToday -= 1;
  const id = `mock${kind}`;
  return {
    status: 200,
    body: {
      type:
        kind === 'review'
          ? 'reviewCreate'
          : kind === 'elo'
            ? 'eloCreate'
            : 'pollCreate',
      postId: `t3_${id}`,
      url: `https://www.reddit.com/r/chess_hub_dev/comments/${id}/`,
    },
  };
}

function reviewAnalysis(body: unknown): MockResponse {
  if (state?.post.kind !== 'review') return error(404, 'not a review post');
  const post = state.post;
  if (!post.analysis) {
    const game = parseGame(post.pgn);
    if ('error' in game) return error(400, 'stored game is invalid');
    const valid = validateAnalysis(body, game.fens);
    if ('error' in valid) return error(400, valid.error);
    post.analysis = valid;
    // Kept for regenerating fixtures: copy(JSON.stringify(window.__lastReview)).
    Object.assign(window, { __lastReview: valid });
  }
  return {
    status: 200,
    body: { type: 'reviewAnalysis', analysis: post.analysis },
  };
}

function leaderboard(kind: LeaderboardKind): MockResponse {
  const base: Record<LeaderboardKind, (i: number) => number> = {
    streak: (i) => Math.max(1, 41 - i * 3),
    rating: (i) => 2310 - i * 47,
    solved: (i) => 180 - i * 13,
    elo: (i) => 1240 - i * 71,
  };
  const entries = LEADERBOARD.filter((e) => !removed.includes(e.username)).map(
    (e, i) => ({
      ...e,
      rank: i + 1,
      value: base[kind](i),
    })
  );
  const username = state?.username ?? null;
  const body: LeaderboardResponse = {
    type: 'leaderboard',
    kind,
    entries,
    me: username
      ? (entries.find((e) => e.username === username) ?? null)
      : null,
  };
  return { status: 200, body };
}

async function route(
  url: URL,
  init: RequestInit | undefined
): Promise<MockResponse> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
  const path = `${method} ${url.pathname}`;
  switch (path) {
    case 'GET /api/init': {
      state ??= initial ? structuredClone(initial) : null;
      // Reveal hidden results once a poll has closed.
      if (
        state?.post.kind === 'poll' &&
        state.post.results === null &&
        state.post.closesAt !== null &&
        state.post.closesAt <= Date.now()
      ) {
        state.post.results = structuredClone(secret.pollResults ?? []);
      }
      return state
        ? { status: 200, body: state }
        : error(500, 'mock server error');
    }
    case 'POST /api/puzzle/move':
      return puzzleMove(body);
    case 'POST /api/puzzle/hint':
      return puzzleHint(body);
    case 'POST /api/puzzle/reveal':
      return puzzleReveal();
    case 'POST /api/poll/vote':
      return pollVote(body);
    case 'POST /api/poll/create':
      return createPost('poll', body);
    case 'POST /api/review/create':
      return createPost('review', body);
    case 'POST /api/elo/create':
      return createPost('elo', body);
    case 'POST /api/game/fetch': {
      if (!state?.username) return error(401, 'Log in first.');
      const url =
        isRecord(body) && typeof body.url === 'string' ? body.url : '';
      if (!/lichess\.org\/\w{8}/.test(url))
        return error(400, 'That isn’t a Lichess game link.');
      return { status: 200, body: { type: 'gameFetch', pgn: GAME_FETCH_PGN } };
    }
    case 'POST /api/game/vote':
      return gameVote(body);
    case 'POST /api/elo/guess':
      return eloGuess(body);
    case 'POST /api/review/analysis':
      return reviewAnalysis(body);
    case 'POST /api/review/reset': {
      if (state?.post.kind !== 'review') return error(404, 'not a review post');
      if (!state.post.canReset)
        return error(403, 'Only the author or a moderator can do that.');
      state.post.analysis = null;
      return { status: 200, body: { type: 'reviewReset' } };
    }
    case 'POST /api/leaderboard/remove': {
      if (!state?.canModerate) return error(403, 'Moderators only.');
      const name =
        isRecord(body) && typeof body.username === 'string'
          ? body.username
          : '';
      removed = [...removed, name];
      return { status: 200, body: { type: 'leaderboardRemove' } };
    }
    case 'GET /api/leaderboard': {
      const kind = url.searchParams.get('kind');
      if (
        kind !== 'streak' &&
        kind !== 'rating' &&
        kind !== 'solved' &&
        kind !== 'elo'
      ) {
        return error(400, 'bad kind');
      }
      return leaderboard(kind);
    }
    default:
      return error(404, `no mock for ${path}`);
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.href
  );
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
    return realFetch(input, init);
  }
  await new Promise((r) => setTimeout(r, latency));
  const res = await route(url, init);
  console.info(
    '[mock api]',
    init?.method ?? 'GET',
    url.pathname + url.search,
    res.status,
    res.body
  );
  return new Response(JSON.stringify(res.body), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
