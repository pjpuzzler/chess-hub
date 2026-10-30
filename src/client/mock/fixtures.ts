// Fixture data for the local mock harness (`npm run mock`). Never imported by
// production code: only src/client/mock/* uses it, and that is reachable only
// through the mock-mode alias in vite.config.ts.
import type {
  CreateOptions,
  EloReveal,
  EloView,
  GameView,
  InitResponse,
  LeaderboardEntry,
  PollResult,
  PostCard,
  PostData,
  PuzzleMe,
  PuzzleView,
  ReviewAnalysis,
} from '../../shared/api';
import { fenAtPly } from '../../shared/chess/puzzle';
import { parseGame, validateAnalysis } from '../../shared/chess/review';
import { retiAnalysis } from './review-reti';

export type Fixture = {
  label: string;
  postData: PostData;
  username: string | null;
  // null makes GET /api/init fail with a 500, to exercise error states.
  init: InitResponse | null;
  // Server-only data the mock routes need.
  secret?: {
    solution?: string[]; // puzzle line, setup move first
    themes?: string[];
    pollResults?: PollResult[]; // hidden until the viewer votes
    eloReveal?: EloReveal;
  };
};

const HOUR = 3_600_000;
const NOW = Date.now();

export const MEMBER: CreateOptions = {
  review: true,
  elo: true,
  poll: true,
  remainingToday: 5,
};
export const MOD: CreateOptions = {
  review: true,
  elo: true,
  poll: true,
  remainingToday: 99,
};
const NONE: CreateOptions = {
  review: false,
  elo: false,
  poll: false,
  remainingToday: 0,
};

const init = (
  post: InitResponse['post'],
  username: string | null,
  opts: { anarchy?: boolean; mod?: boolean; create?: CreateOptions } = {}
): InitResponse => ({
  type: 'init',
  postId: 't3_mock',
  username,
  post,
  flags: { anarchy: opts.anarchy ?? false },
  canModerate: opts.mod ?? false,
  create: username === null ? NONE : (opts.create ?? (opts.mod ? MOD : MEMBER)),
});

// ---------- puzzle: Lichess 00008 (CC0). White: Rxe7, Nc1, Qxc1. ----------
const PUZZLE_FEN = 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24';
const PUZZLE_LINE = ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'];
const PUZZLE_THEMES = ['crushing', 'hangingPiece', 'long', 'middlegame'];
const puzzleSecret = { solution: PUZZLE_LINE, themes: PUZZLE_THEMES };

const ME_FRESH: PuzzleMe = {
  status: 'unsolved',
  cleanSolve: false,
  streak: 6,
  bestStreak: 11,
  rating: 1687,
  solvedTotal: 23,
};

const puzzle = (
  me: PuzzleMe | null,
  finished: boolean,
  tagline: string | null = null,
  currentElo: PuzzleView['currentElo'] = null
): PuzzleView => ({
  kind: 'puzzle',
  number: 42,
  date: '2026-10-29',
  puzzle: {
    id: '00008',
    fen: PUZZLE_FEN,
    setupMove: 'f2g3',
    solverMoves: 3,
    rating: 1913,
    solution: finished ? PUZZLE_LINE : null,
    themes: finished ? PUZZLE_THEMES : null,
  },
  stats: { attempts: 318, cleanSolves: 201 },
  me,
  nextPuzzleAt: NOW + 7 * HOUR + 12 * 60_000,
  tagline,
  currentElo,
});
// Like the server, postData shows the solver's position (after the setup move).
const puzzlePostData: PostData = {
  kind: 'puzzle',
  fen: fenAtPly(PUZZLE_FEN, PUZZLE_LINE, 1),
  orientation: 'white',
};

// ---------- poll: Morphy's Opera Game before 13.Rxd7 ----------
const POLL_FEN = '3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13';
const POLL_RESULTS: PollResult[] = [
  { move: 'd1d7', san: 'Rxd7', votes: 412 },
  { move: 'g5f6', san: 'Bxf6', votes: 133 },
  { move: 'b3a4', san: 'Qa4', votes: 61 },
  { move: 'h1e1', san: 'Rhe1', votes: 29 },
];
const POLL_TOTAL = POLL_RESULTS.reduce((n, r) => n + r.votes, 0);
const pollPostData: PostData = {
  kind: 'poll',
  fen: POLL_FEN,
  orientation: 'white',
};
const pollPost = (
  myVote: string | null,
  closesAt: number | null,
  shown: boolean
) =>
  ({
    kind: 'poll',
    fen: POLL_FEN,
    prompt: 'White to play',
    lastMove: 'a8d8',
    closesAt,
    totalVotes: POLL_TOTAL,
    myVote,
    results: shown ? POLL_RESULTS : null,
  }) satisfies InitResponse['post'];

// En passant is legal here (exd6), for the anarchy easter egg.
const EP_FEN = 'rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';

// ---------- review ----------
// Kasparov vs Topalov, Wijk aan Zee 1999 (87 plies): the timing benchmark.
const TOPALOV_PGN = `[Event "Hoogovens"]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[White "Garry Kasparov"]
[Black "Veselin Topalov"]
[Result "1-0"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6
Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4
15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1
d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+
Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+
Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8
Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`;

// Réti vs Tartakower, Vienna 1910 (21 plies). Its analysis in review-reti.ts
// was produced by this client's own review run (see BatchAnalyzer).
const RETI_PGN = `[Event "Vienna"]
[Date "1910.??.??"]
[White "Richard Réti"]
[Black "Savielly Tartakower"]
[Result "1-0"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5
8. O-O-O Nxe4 9. Qd8+ Kxd8 10. Bg5+ Kc7 11. Bd8# 1-0`;

function reviewGame(pgn: string) {
  const game = parseGame(pgn);
  if ('error' in game) throw new Error(game.error);
  return game;
}

const retiChecked = validateAnalysis(retiAnalysis, reviewGame(RETI_PGN).fens);
const RETI_ANALYSIS = 'error' in retiChecked ? null : retiChecked;

// Mirrors the server: postData shows the final position, pgn is normalised.
function reviewFixture(
  label: string,
  pgn: string,
  caption: string,
  analysis: ReviewAnalysis | null
): Fixture {
  const game = reviewGame(pgn);
  return {
    label,
    postData: {
      kind: 'review',
      fen: game.fens[game.fens.length - 1] ?? '',
      orientation: 'white',
    },
    username: 'kibitzer',
    init: init(
      {
        kind: 'review',
        pgn: game.pgn,
        white: game.white,
        black: game.black,
        result: game.result,
        caption,
        author: 'kibitzer',
        analysis,
        canReset: true,
      },
      'kibitzer'
    ),
  };
}

// Returned by the mock /api/game/fetch for any Lichess link.
export const GAME_FETCH_PGN =
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 ' +
  '8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 ' +
  '14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0';

// Promotion on the board (poll), for the picker.
const PROMO_FEN = '7k/4P3/8/8/8/8/6K1/8 w - - 0 1';

// ---------- community game ----------
// Italian Game after 3...Bc5, White to play move 4.
const GAME_MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'];
const GAME_FEN =
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const GAME_RESULTS: PollResult[] = [
  { move: 'c2c3', san: 'c3', votes: 41 },
  { move: 'e1g1', san: 'O-O', votes: 37 },
  { move: 'd2d3', san: 'd3', votes: 22 },
  { move: 'b2b4', san: 'b4', votes: 9 },
];
const GAME_TOTAL = GAME_RESULTS.reduce((n, r) => n + r.votes, 0);
const gamePostData: PostData = {
  kind: 'game',
  fen: GAME_FEN,
  orientation: 'white',
};
const gamePost = (over: Partial<GameView> = {}): GameView => ({
  kind: 'game',
  gameNumber: 2,
  moveNumber: 4,
  fen: GAME_FEN,
  turn: 'white',
  lastMove: 'f8c5',
  moves: GAME_MOVES,
  status: 'open',
  totalVotes: GAME_TOTAL,
  myVote: null,
  results: null,
  winningMove: null,
  nextPostId: null,
  ...over,
});

// Result post of a finished community game, as the server makes it: a
// review with no author and the subreddit on both sides.
const COMMUNITY_RESULT_PGN = `[Event "r/AnarchyChess community game"]
[White "r/AnarchyChess"]
[Black "r/AnarchyChess"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1`;
const communityResult = reviewGame(COMMUNITY_RESULT_PGN);

// ---------- guess the elo ----------
// A real-looking club game (movetext only, names removed like the server).
const ELO_PGN =
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Bd2 Bxd2+ ' +
  '8. Nbxd2 d5 9. exd5 Nxd5 10. Qb3 Nce7 11. O-O O-O 12. Rfe1 c6 13. Ne4 Nf5 ' +
  '14. Nc5 b6 15. Ne5 bxc5 16. Bxd5 cxd5 17. Qxd5 Qxd5 18. dxc5 Be6 19. Rad1 Qxc5 ' +
  '20. Rd7 Bxd7 21. Nxd7 Qb4 22. Nxf8 Qxe1# 0-1';
const ELO_REVEAL: EloReveal = {
  white: 1642,
  black: 1718,
  average: 1680,
  histogram: [
    { bucket: 800, count: 4 },
    { bucket: 1000, count: 11 },
    { bucket: 1100, count: 19 },
    { bucket: 1200, count: 33 },
    { bucket: 1300, count: 41 },
    { bucket: 1400, count: 52 },
    { bucket: 1500, count: 47 },
    { bucket: 1600, count: 38 },
    { bucket: 1700, count: 27 },
    { bucket: 1800, count: 18 },
    { bucket: 1900, count: 9 },
    { bucket: 2100, count: 5 },
    { bucket: 2400, count: 2 },
  ],
  totalGuesses: 306,
};
const eloPost = (over: Partial<EloView> = {}): EloView => ({
  kind: 'elo',
  number: 7,
  game: { pgn: ELO_PGN, timeControl: '600+0', result: '0-1' },
  myGuess: null,
  myScore: null,
  reveal: null,
  me: { totalScore: 412, games: 6 },
  source: 'curated',
  author: null,
  caption: '',
  ...over,
});
// Like the server: the splash previews the final position.
const ELO_FINAL = reviewGame(ELO_PGN).fens.at(-1) ?? '';
const eloPostData: PostData = {
  kind: 'elo',
  fen: ELO_FINAL,
  orientation: 'white',
};

export const FIXTURES: Record<string, Fixture> = {
  puzzle: {
    label: 'Puzzle',
    postData: puzzlePostData,
    username: 'kibitzer',
    init: init(puzzle(ME_FRESH, false), 'kibitzer'),
    secret: puzzleSecret,
  },
  'puzzle-anarchy': {
    label: 'Puzzle, anarchy',
    postData: puzzlePostData,
    username: 'kibitzer',
    init: init(puzzle(ME_FRESH, false, 'Google en passant'), 'kibitzer', {
      anarchy: true,
    }),
    secret: puzzleSecret,
  },
  'puzzle-solved': {
    label: 'Puzzle, solved earlier',
    postData: puzzlePostData,
    username: 'kibitzer',
    init: init(
      puzzle(
        {
          ...ME_FRESH,
          status: 'solved',
          cleanSolve: true,
          streak: 7,
          solvedTotal: 24,
        },
        true,
        null,
        { postId: 't3_elo7', number: 7 }
      ),
      'kibitzer'
    ),
    secret: puzzleSecret,
  },
  'puzzle-failed': {
    label: 'Puzzle, missed earlier',
    postData: puzzlePostData,
    username: 'kibitzer',
    init: init(
      puzzle({ ...ME_FRESH, status: 'failed', streak: 0, rating: 1674 }, true),
      'kibitzer'
    ),
    secret: puzzleSecret,
  },
  'puzzle-logged-out': {
    label: 'Puzzle, logged out',
    postData: puzzlePostData,
    username: null,
    init: init(puzzle(null, false), null),
    secret: puzzleSecret,
  },
  poll: {
    label: 'Poll',
    postData: pollPostData,
    username: 'kibitzer',
    init: init(pollPost(null, NOW + 5 * HOUR, false), 'kibitzer'),
    secret: { pollResults: POLL_RESULTS },
  },
  'poll-closing': {
    label: 'Poll, closes in 20 s',
    postData: pollPostData,
    username: 'kibitzer',
    init: init(pollPost(null, NOW + 20_000, false), 'kibitzer'),
    secret: { pollResults: POLL_RESULTS },
  },
  'poll-voted': {
    label: 'Poll, voted (1 post left)',
    postData: pollPostData,
    username: 'kibitzer',
    init: init(pollPost('g5f6', NOW + 5 * HOUR, true), 'kibitzer', {
      create: { ...MEMBER, remainingToday: 1 },
    }),
  },
  'poll-closed': {
    label: 'Poll, closed',
    postData: pollPostData,
    username: 'kibitzer',
    init: init(pollPost(null, NOW - HOUR, true), 'kibitzer'),
  },
  anarchy: {
    label: 'Anarchy (en passant)',
    postData: { kind: 'poll', fen: EP_FEN, orientation: 'white' },
    username: 'kibitzer',
    init: init(
      {
        kind: 'poll',
        fen: EP_FEN,
        prompt: 'White to play',
        lastMove: 'd7d5',
        closesAt: null,
        totalVotes: 1337,
        myVote: null,
        results: null,
      },
      'kibitzer',
      { anarchy: true }
    ),
    secret: { pollResults: [{ move: 'e5d6', san: 'exd6', votes: 1337 }] },
  },
  'poll-promotion': {
    label: 'Poll, promotion',
    postData: { kind: 'poll', fen: PROMO_FEN, orientation: 'white' },
    username: 'kibitzer',
    init: init(
      {
        kind: 'poll',
        fen: PROMO_FEN,
        prompt: 'White to play',
        lastMove: null,
        closesAt: null,
        totalVotes: 12,
        myVote: null,
        results: null,
      },
      'kibitzer'
    ),
    secret: {
      pollResults: [
        { move: 'e7e8q', san: 'e8=Q+', votes: 9 },
        { move: 'e7e8r', san: 'e8=R+', votes: 3 },
      ],
    },
  },
  review: reviewFixture(
    'Review, not run',
    TOPALOV_PGN,
    'Kasparov’s Immortal',
    null
  ),
  'review-analyzed': reviewFixture('Review, done', RETI_PGN, '', RETI_ANALYSIS),
  game: {
    label: 'Game #2',
    postData: gamePostData,
    username: 'kibitzer',
    init: init(gamePost(), 'kibitzer'),
    secret: { pollResults: GAME_RESULTS },
  },
  'game-voted': {
    label: 'Game, voted',
    postData: gamePostData,
    username: 'kibitzer',
    init: init(
      gamePost({
        myVote: 'e1g1',
        totalVotes: GAME_TOTAL + 1,
        results: GAME_RESULTS.map((r) =>
          r.move === 'e1g1' ? { ...r, votes: r.votes + 1 } : r
        ),
      }),
      'kibitzer'
    ),
  },
  'game-logged-out': {
    label: 'Game #1, first move, logged out',
    postData: {
      kind: 'game',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      orientation: 'white',
    },
    username: null,
    init: init(
      gamePost({
        gameNumber: 1,
        moveNumber: 1,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        lastMove: null,
        moves: [],
        totalVotes: 3,
      }),
      null
    ),
    secret: { pollResults: [{ move: 'e2e4', san: 'e4', votes: 3 }] },
  },
  'game-closed': {
    label: 'Game, closed',
    postData: gamePostData,
    username: 'kibitzer',
    init: init(
      gamePost({
        status: 'closed',
        myVote: 'e1g1',
        results: GAME_RESULTS,
        winningMove: { move: 'c2c3', san: 'c3' },
        nextPostId: 't3_mockgame5',
      }),
      'kibitzer'
    ),
  },
  'game-ended': {
    label: 'Game, ended by mods',
    postData: gamePostData,
    username: 'kibitzer',
    init: init(
      gamePost({ status: 'ended', results: GAME_RESULTS }),
      'kibitzer'
    ),
  },
  'game-result': {
    label: 'Game, result post',
    postData: {
      kind: 'review',
      fen: communityResult.fens.at(-1) ?? '',
      orientation: 'white',
    },
    username: 'kibitzer',
    init: init(
      {
        kind: 'review',
        pgn: communityResult.pgn,
        white: communityResult.white,
        black: communityResult.black,
        result: communityResult.result,
        caption: 'Black wins by checkmate in 2.',
        author: null,
        analysis: null,
      },
      'kibitzer',
      { anarchy: true }
    ),
  },
  elo: {
    label: 'Elo',
    postData: eloPostData,
    username: 'kibitzer',
    init: init(eloPost(), 'kibitzer'),
    secret: { eloReveal: ELO_REVEAL },
  },
  'elo-guessed': {
    label: 'Elo, guessed',
    postData: eloPostData,
    username: 'kibitzer',
    init: init(
      eloPost({ myGuess: 1550, myScore: 87, reveal: ELO_REVEAL }),
      'kibitzer'
    ),
  },
  'elo-member': {
    label: 'Elo, member game',
    postData: eloPostData,
    username: 'kibitzer',
    init: init(
      eloPost({
        source: 'selfReported',
        author: 'castle_queenside',
        caption: 'My best win this month. How strong are we?',
      }),
      'kibitzer'
    ),
    secret: { eloReveal: ELO_REVEAL },
  },
  error: {
    label: 'Server error',
    postData: puzzlePostData,
    username: 'kibitzer',
    init: null,
  },
};

export const LEADERBOARD: LeaderboardEntry[] = [
  'tal_fan',
  'en_passant_enjoyer',
  'knightrider',
  'zugzwangster',
  'castle_queenside',
  'fianchetto_fred',
  'blunder_check',
  'pawnstorm',
  'rook_lift',
  'opposite_bishops',
  'il_vaticano',
  'kibitzer',
].map((username, i) => ({ rank: i + 1, username, value: 0 }));

/**
 * The feed card's fixed text, as the server puts it in postData when it makes
 * the post (derived from the fixture's init so the two always agree).
 */
export function cardFor(init: InitResponse): PostCard {
  const post = init.post;
  switch (post.kind) {
    case 'puzzle':
      return {
        kind: 'puzzle',
        number: post.number,
        rating: post.puzzle.rating,
        tagline: post.tagline,
        anarchy: init.flags.anarchy,
      };
    case 'poll':
      return { kind: 'poll', prompt: post.prompt };
    case 'review': {
      const game = /community game(?: #(\d+))?/.exec(post.pgn);
      return {
        kind: 'review',
        white: post.white,
        black: post.black,
        result: post.result,
        caption: post.caption,
        game: post.author === null && game ? Number(game[1] ?? 1) : null,
      };
    }
    case 'elo':
      return {
        kind: 'elo',
        number: post.number,
        timeControl: post.game.timeControl,
      };
    case 'game':
      return {
        kind: 'game',
        gameNumber: post.gameNumber,
        moveNumber: post.moveNumber,
      };
  }
}
