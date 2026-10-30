// Community game: mods start it, the subreddit plays both sides, one voted
// move a day at the posting hour. One game at a time per install.
import { context, reddit, redis } from '@devvit/web/server';
import { Chess } from 'chess.js';
import type { GameView, GameVoteResponse, PostData } from '../../shared/api';
import {
  decodeVote,
  encodeVote,
  gameOutcome,
  outcomeText,
  pickWinner,
  type Vote,
} from '../../shared/chess/game';
import { checkMove, sideName, tally } from '../../shared/chess/poll';
import { claimDate, retry, utcDate } from './daily';
import { highlightGamePost } from './pin';
import { getCounts } from './pollVote';
import { getSettings } from './settings';
import { expireClosedVotes, touchUser } from './privacy';
import { GENERIC } from './posts';
import {
  getPost,
  keys,
  parseJson,
  putPost,
  toInt,
  withTransaction,
  type StoredGamePost,
} from './store';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const STATE_VERSION = 1;

// Stored as JSON with a version so later releases can migrate or ignore it.
export type GameState = {
  version: 1;
  gameNumber: number;
  moves: string[]; // UCI, from the standard start
  openPostId: string | null; // null once the game is over
  // The post being closed by the last advance, until it is marked closed
  // (lets the next run finish the job after a crash).
  prev?: { postId: string; winningMove: string; nextPostId: string } | null;
};

export const readState = async (): Promise<GameState | null> => {
  const v = parseJson(await redis.get(keys.gameState));
  if (typeof v !== 'object' || v === null) return null;
  if (Reflect.get(v, 'version') !== STATE_VERSION) return null; // unknown: no game
  const gameNumber: unknown = Reflect.get(v, 'gameNumber');
  const moves: unknown = Reflect.get(v, 'moves');
  const openPostId: unknown = Reflect.get(v, 'openPostId');
  if (
    typeof gameNumber !== 'number' ||
    !Array.isArray(moves) ||
    !moves.every((m) => typeof m === 'string') ||
    (openPostId !== null && typeof openPostId !== 'string')
  )
    return null;
  const prev: unknown = Reflect.get(v, 'prev');
  const okPrev =
    typeof prev === 'object' &&
    prev !== null &&
    typeof Reflect.get(prev, 'postId') === 'string' &&
    typeof Reflect.get(prev, 'winningMove') === 'string' &&
    typeof Reflect.get(prev, 'nextPostId') === 'string';
  return {
    version: 1,
    gameNumber,
    moves,
    openPostId,
    prev: okPrev
      ? {
          postId: String(Reflect.get(prev, 'postId')),
          winningMove: String(Reflect.get(prev, 'winningMove')),
          nextPostId: String(Reflect.get(prev, 'nextPostId')),
        }
      : null,
  };
};

/**
 * Change the state atomically: `fn` sees the current state and returns the
 * new one, or null to leave it alone. Returns what was written (or null).
 */
const updateState = async (
  fn: (s: GameState | null) => GameState | null
): Promise<GameState | null> =>
  withTransaction([keys.gameState], async (txn) => {
    const next = fn(await readState());
    if (!next) return { value: null, write: false };
    await txn.set(keys.gameState, JSON.stringify(next));
    return { value: next, write: true };
  });

const openRecord = (gameNumber: number, moves: string[]): StoredGamePost => ({
  kind: 'game',
  gameNumber,
  fen: fenAfter(moves),
  moves,
  status: 'open',
  winningMove: null,
  nextPostId: null,
});

const fenAfter = (moves: string[]): string => {
  const chess = new Chess(START);
  for (const m of moves)
    chess.move({
      from: m.slice(0, 2),
      to: m.slice(2, 4),
      ...(m[4] ? { promotion: m[4] } : {}),
    });
  return chess.fen();
};

const label = (n: number) =>
  `r/${context.subredditName} community game${n > 1 ? ` #${n}` : ''}`;

const sideLabel = (s: 'white' | 'black') => (s === 'white' ? 'White' : 'Black');

/** Submit the voting post for the position after `moves`. */
const submitMovePost = async (gameNumber: number, moves: string[]) => {
  const fen = fenAfter(moves);
  const turn = sideName(new Chess(fen).turn());
  const moveNumber = Math.floor(moves.length / 2) + 1;
  const title = `${label(gameNumber)} · Move ${moveNumber} · ${sideLabel(turn)} to play`;
  const postData: PostData = { kind: 'game', fen, orientation: turn };
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title,
    postData,
    textFallback: { text: `${title}. Vote for the next move. FEN: ${fen}` },
  });
  return { postId: post.id, record: openRecord(gameNumber, moves) };
};

/** PGN of a finished community game, for the result (review) post. */
const gamePgn = (
  gameNumber: number,
  moves: string[],
  result: string
): string => {
  const chess = new Chess(START);
  for (const m of moves)
    chess.move({
      from: m.slice(0, 2),
      to: m.slice(2, 4),
      ...(m[4] ? { promotion: m[4] } : {}),
    });
  const sub = `r/${context.subredditName}`;
  chess.setHeader('Event', label(gameNumber));
  chess.setHeader('White', sub);
  chess.setHeader('Black', sub);
  chess.setHeader('Result', result);
  return chess.pgn();
};

/** Submit the closing post: a review post of the whole game. */
const submitResultPost = async (gameNumber: number, moves: string[]) => {
  const outcome = gameOutcome(START, moves);
  if (!outcome) throw new Error('game is not over');
  const summary = outcomeText(outcome, moves.length);
  const title = `${label(gameNumber)} · ${summary}`;
  const sub = `r/${context.subredditName}`;
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title,
    postData: { kind: 'review', fen: fenAfter(moves), orientation: 'white' },
    textFallback: { text: `${title}.` },
  });
  return {
    postId: post.id,
    record: {
      kind: 'review' as const,
      pgn: gamePgn(gameNumber, moves, outcome.result),
      white: sub,
      black: sub,
      result: outcome.result,
      caption: `${summary}.`,
      author: null,
    },
  };
};

/** Best-effort highlight per the "Highlight the community game" setting. */
const highlight = async (
  postId: string,
  previousId: string | null,
  now: Date
) => {
  try {
    const s = await getSettings();
    await highlightGamePost(
      postId,
      previousId,
      s.highlightGame,
      s.postHourUtc,
      now
    );
  } catch (e) {
    console.error(`game highlight failed: ${e}`);
  }
};

export type StartResult =
  { ok: true; postId: string } | { ok: false; error: string };

const LOCK_STALE_MS = 60_000;

/** Mod action: start a new game and post move 1 right away. */
export const startGame = async (
  now: Date = new Date()
): Promise<StartResult> => {
  // One Start at a time: a lock, then the state check under it.
  const t = now.getTime();
  const locked =
    (await redis.hSetNX(keys.gameStartLock, 'held', String(t))) === 1;
  if (!locked) {
    const held = toInt(await redis.hGet(keys.gameStartLock, 'held'));
    if (t - held < LOCK_STALE_MS)
      return { ok: false, error: 'Try again in a minute.' };
    await redis.hSet(keys.gameStartLock, { held: String(t) });
  }
  try {
    if ((await readState())?.openPostId)
      return { ok: false, error: 'A community game is already running.' };
    const date = utcDate(now);
    // Today's post is move 1, so the daily run skips today. Under the lock
    // it is safe to take over a claim left by a game that ended today.
    await redis.hSet(keys.dates('game'), { [date]: `pending:${t}` });
    const gameNumber = toInt(await redis.get(keys.gameCount)) + 1;
    let made;
    try {
      made = await submitMovePost(gameNumber, []);
    } catch (e) {
      await redis.hDel(keys.dates('game'), [date]).catch(() => undefined);
      console.error(`start game failed: ${e}`);
      return { ok: false, error: GENERIC };
    }
    const { postId, record } = made;
    // State first: it is the commit point (a missing record is rebuilt).
    await retry('game state', () =>
      redis.mSet({
        [keys.gameCount]: String(gameNumber),
        [keys.gameState]: JSON.stringify({
          version: 1,
          gameNumber,
          moves: [],
          openPostId: postId,
          prev: null,
        } satisfies GameState),
      })
    );
    await retry('game post', () => putPost(postId, record));
    await retry('game date', () =>
      redis.hSet(keys.dates('game'), { [date]: postId })
    );
    await highlight(postId, null, now);
    return { ok: true, postId };
  } finally {
    await redis.hDel(keys.gameStartLock, ['held']).catch(() => undefined);
  }
};

/** Mod action: stop the current game. Nothing is posted. */
export const endGame = async (): Promise<boolean> => {
  let endedId: string | null = null;
  await updateState((s) => {
    endedId = s?.openPostId ?? null;
    return s?.openPostId ? { ...s, openPostId: null } : null;
  });
  if (!endedId) return false;
  const post = await getPost(endedId);
  if (post?.kind === 'game') {
    await putPost(endedId, {
      ...post,
      status: 'ended',
      finalCounts: countVotes(await readVotes(endedId)),
    });
    await expireClosedVotes(keys.votes(endedId), Date.now());
  }
  return true;
};

export type AdvanceResult =
  | { status: 'none' } // no game, already done today, or a run is in progress
  | { status: 'novotes' }
  | { status: 'posted'; postId: string; over: boolean }
  | { status: 'error' };

const readVotes = async (postId: string): Promise<Vote[]> =>
  Object.values(await redis.hGetAll(keys.votes(postId)))
    .map(decodeVote)
    .filter((v): v is Vote => v !== null);

const countVotes = (votes: Vote[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of votes) out[v.move] = (out[v.move] ?? 0) + 1;
  return out;
};

/**
 * Repair what a crash mid-advance can leave behind: a previous post not yet
 * marked closed, a missing record for the open post, or (older ordering) an
 * open post already closed with a successor the state never moved to.
 */
const heal = async (state: GameState): Promise<GameState> => {
  let s = state;
  if (s.prev) {
    const p = s.prev;
    const old = await getPost(p.postId);
    if (old?.kind === 'game' && old.status !== 'closed') {
      const votes = await readVotes(p.postId);
      await putPost(p.postId, {
        ...old,
        status: 'closed',
        winningMove: p.winningMove,
        nextPostId: p.nextPostId,
        finalCounts: countVotes(votes),
      });
    }
    s = (await updateState((cur) =>
      cur?.prev ? { ...cur, prev: null } : null
    )) ?? {
      ...s,
      prev: null,
    };
  }
  if (!s.openPostId) return s;
  const open = await getPost(s.openPostId);
  if (!open) {
    await putPost(s.openPostId, openRecord(s.gameNumber, s.moves));
  } else if (
    open.kind === 'game' &&
    open.status === 'closed' &&
    open.nextPostId &&
    open.winningMove
  ) {
    const moves = [...open.moves, open.winningMove];
    const over = gameOutcome(START, moves) !== null;
    const from = s.openPostId;
    const nextId = open.nextPostId;
    s =
      (await updateState((cur) =>
        cur?.openPostId === from
          ? { ...cur, moves, openPostId: over ? null : nextId }
          : null
      )) ?? s;
    if (!over && s.openPostId && !(await getPost(s.openPostId)))
      await putPost(s.openPostId, openRecord(s.gameNumber, moves));
  }
  return s;
};

/**
 * Daily step (hourly task, after the posting hour): close the open post, play
 * the winning move and post the next position, or the result post if the game
 * is over. At most once per UTC date; a day with no votes posts nothing and
 * leaves the same post open.
 */
export const advanceGame = async (
  now: Date = new Date()
): Promise<AdvanceResult> => {
  const read = await readState();
  if (!read?.openPostId) return { status: 'none' };
  const state = await heal(read);
  const prevId = state.openPostId;
  if (!prevId) return { status: 'none' };
  const open = await getPost(prevId);
  if (
    open?.kind !== 'game' ||
    (open.status !== 'open' && open.status !== 'closing')
  )
    return { status: 'none' };
  const date = utcDate(now);
  if (!(await claimDate('game', date, now))) return { status: 'none' };

  // Refuse new votes before counting (castGameVote re-checks after its gate).
  await putPost(prevId, { ...open, status: 'closing' });
  // Only undo our own 'closing' (a mod may have ended the game meanwhile).
  const reopen = async () => {
    const cur = await getPost(prevId);
    if (cur?.kind === 'game' && cur.status === 'closing')
      await putPost(prevId, { ...cur, status: 'open' });
  };
  const votes = await readVotes(prevId);
  const winner = pickWinner(votes);
  if (!winner) {
    await reopen();
    // Keep the claim so no post goes up today; the same post stays open (and
    // stays highlighted for another day).
    await highlight(prevId, null, now);
    await redis.hSet(keys.dates('game'), { [date]: `novotes:${prevId}` });
    return { status: 'novotes' };
  }

  const moves = [...state.moves, winner];
  const over = gameOutcome(START, moves) !== null;
  let made: { postId: string; record: Parameters<typeof putPost>[1] };
  try {
    made = over
      ? await submitResultPost(state.gameNumber, moves)
      : await submitMovePost(state.gameNumber, moves);
  } catch (e) {
    await reopen().catch(() => undefined);
    await redis.hDel(keys.dates('game'), [date]).catch(() => undefined);
    console.error(`community game post failed: ${e}`);
    return { status: 'error' };
  }
  const { postId, record } = made;

  // Commit point: move the state forward, but only if nobody ended the game
  // or deleted the open post while we were posting.
  let moved = false;
  await retry('game state', async () => {
    const wrote = await updateState((cur) =>
      cur?.openPostId === prevId
        ? {
            ...cur,
            moves,
            openPostId: over ? null : postId,
            prev: { postId: prevId, winningMove: winner, nextPostId: postId },
          }
        : null
    );
    moved = wrote !== null;
  });
  await retry('game date', () =>
    redis.hSet(keys.dates('game'), { [date]: postId })
  );
  if (!moved) {
    // The game was ended meanwhile: the new post must not take votes.
    await retry('end new post', () =>
      putPost(
        postId,
        record.kind === 'game' ? { ...record, status: 'ended' } : record
      )
    );
    return { status: 'none' };
  }
  await retry('game post', () => putPost(postId, record));
  const closed = await retry('close previous', () =>
    putPost(prevId, {
      ...open,
      status: 'closed',
      winningMove: winner,
      nextPostId: postId,
      finalCounts: countVotes(votes),
    })
  );
  // Who voted for what goes 30 days after closing; finalCounts keep results.
  await expireClosedVotes(keys.votes(prevId), now.getTime()).catch(
    () => undefined
  );
  await expireClosedVotes(keys.gameSeq(prevId), now.getTime()).catch(
    () => undefined
  );
  // Keep `prev` until the old post really is closed, so a later run can finish.
  if (closed)
    await retry('clear prev', () =>
      updateState((cur) =>
        cur?.prev?.postId === prevId ? { ...cur, prev: null } : null
      )
    );
  await highlight(postId, prevId, now);
  return { status: 'posted', postId, over };
};

// ------------------------------------------------------------------ voting ----

export type GameVoteOutcome =
  | { ok: true; response: GameVoteResponse }
  | { ok: false; status: 400 | 409; message: string };

const CLOSED = 'Voting on this move has closed.';

/**
 * One final vote per user per open post. The vote value carries its order
 * ("<uci>@<seq>") in the same atomic hSetNX that gates it, so the tally and
 * tie-break are exact even if a request dies halfway.
 */
export const castGameVote = async (
  username: string,
  postId: string,
  post: StoredGamePost,
  move: string
): Promise<GameVoteOutcome> => {
  if (post.status !== 'open')
    return { ok: false, status: 409, message: CLOSED };
  const checked = checkMove(post.fen, move);
  if (!checked)
    return {
      ok: false,
      status: 400,
      message: 'That is not a legal move here.',
    };
  const seq = await redis.incrBy(keys.gameSeq(postId), 1);
  await touchUser(username, { postId });
  if (
    (await redis.hSetNX(
      keys.votes(postId),
      username,
      encodeVote(checked.uci, seq)
    )) !== 1
  )
    return { ok: false, status: 409, message: 'You have already voted.' };
  // The tally may have started since we checked: then this vote does not count.
  const now = await getPost(postId);
  if (now?.kind !== 'game' || now.status !== 'open') {
    await redis.hDel(keys.votes(postId), [username]);
    return { ok: false, status: 409, message: CLOSED };
  }
  await redis.hIncrBy(keys.counts(postId), checked.uci, 1); // display only
  const results = tally(post.fen, await getCounts(postId));
  return {
    ok: true,
    response: {
      type: 'gameVote',
      myVote: checked.uci,
      totalVotes: results.reduce((s, r) => s + r.votes, 0),
      results,
    },
  };
};

export const buildGameView = async (
  postId: string,
  post: StoredGamePost,
  username: string | null
): Promise<GameView> => {
  const raw = username
    ? await redis.hGet(keys.votes(postId), username)
    : undefined;
  const myVote = raw ? (decodeVote(raw)?.move ?? null) : null;
  const results = tally(
    post.fen,
    post.finalCounts ?? (await getCounts(postId))
  );
  const chess = new Chess(post.fen);
  const win = post.winningMove ? checkMove(post.fen, post.winningMove) : null;
  const status = post.status === 'closing' ? 'open' : post.status;
  return {
    kind: 'game',
    gameNumber: post.gameNumber,
    moveNumber: chess.moveNumber(),
    fen: post.fen,
    turn: sideName(chess.turn()),
    lastMove: post.moves[post.moves.length - 1] ?? null,
    moves: post.moves,
    status,
    totalVotes: results.reduce((s, r) => s + r.votes, 0),
    myVote,
    results: myVote !== null || status !== 'open' ? results : null,
    winningMove: win ? { move: win.uci, san: win.san } : null,
    nextPostId: post.nextPostId,
  };
};

/** onPostDelete: if the open post goes, the game ends. */
export const forgetGamePost = async (postId: string) => {
  await redis.del(keys.gameSeq(postId));
  await updateState((s) =>
    s?.openPostId === postId ? { ...s, openPostId: null } : null
  );
};

/**
 * The open game post's record, rebuilt from the game state if a crash lost it
 * (so the post never 404s). Other posts: whatever is stored.
 */
export const getPostHealed = async (postId: string) => {
  const post = await getPost(postId);
  if (post) return post;
  const s = await readState();
  if (s?.openPostId !== postId) return null;
  const rebuilt = openRecord(s.gameNumber, s.moves);
  await putPost(postId, rebuilt);
  return rebuilt;
};
