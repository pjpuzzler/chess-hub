// API contract between the webview client and the Devvit server.
// Moves are UCI strings ("e2e4", "e7e8q"). Positions are FEN strings.

export type PostKind = 'puzzle' | 'poll' | 'review' | 'elo' | 'game';

// Stored in Reddit postData (2 KB limit), so the inline splash can render the
// board preview from `context.postData` before /api/init returns.
export type PostData = {
  kind: PostKind;
  fen: string;
  // Board orientation: the side the reader plays / is asked about.
  orientation: 'white' | 'black';
  // The card's fixed text, so it shows before /api/init returns. Absent on
  // posts made before it existed (the card shows placeholders until init).
  card?: PostCard;
};

// Only what is fixed when the post is made; votes, results and the viewer's
// own state still come from /api/init. Same `kind` as the PostData.
export type PostCard =
  | {
      kind: 'puzzle';
      number: number;
      rating: number;
      tagline: string | null;
      anarchy: boolean; // the subreddit's style (label "Daily Anarchy Puzzle")
    }
  | { kind: 'poll'; prompt: string }
  | {
      kind: 'review';
      white: string;
      black: string;
      result: string;
      caption: string; // may be cut short (postData is small)
      game: number | null; // a community game's result post: its number
    }
  | { kind: 'elo'; number: number; timeControl: string }
  | { kind: 'game'; gameNumber: number; moveNumber: number };

// The solution is never sent before the viewer finishes or gives up; the
// server checks each move (anti-cheat).
export type Puzzle = {
  id: string; // Lichess puzzle id
  // Position BEFORE the opponent's setup move (Lichess convention).
  fen: string;
  setupMove: string; // the opponent's move the client animates first
  solverMoves: number; // how many moves the solver must find
  rating: number;
  // Full line (setup move first) and themes: only once the viewer has
  // finished (solved or revealed); null before.
  solution: string[] | null;
  themes: string[] | null;
};

export type PuzzleStatus = 'unsolved' | 'solved' | 'failed';

export type PuzzleMe = {
  // Result for this post. 'failed' means the first attempt missed; a later
  // correct attempt moves it to 'solved' but keeps `cleanSolve` false.
  status: PuzzleStatus;
  cleanSolve: boolean;
  // Consecutive daily puzzles solved (any solve counts, even after a miss or
  // hint; giving up does not). Rating and cleanSolve are first attempt only.
  streak: number;
  bestStreak: number;
  rating: number; // per-subreddit puzzle rating, starts at 1500
  solvedTotal: number; // daily puzzles solved (any solve, once each)
};

export type PuzzleStats = {
  attempts: number; // users who made a first attempt
  cleanSolves: number; // users who solved on the first try without hints
};

export type PuzzleView = {
  kind: 'puzzle';
  number: number; // "Daily Puzzle #N" for this subreddit
  date: string; // YYYY-MM-DD (UTC) the puzzle is for
  puzzle: Puzzle;
  stats: PuzzleStats;
  me: PuzzleMe | null; // null when logged out
  nextPuzzleAt: number | null; // epoch ms of the next scheduled daily puzzle
  // Anarchy style only: the day's one-line framing, e.g. "Google en passant"
  tagline: string | null;
  // Newest curated Guess the Elo post in this sub (for a quiet "This week:
  // Guess the Elo #N" link); null if there is none or the sub turned it off.
  currentElo: { postId: string; number: number } | null;
};

export type PollResult = { move: string; san: string; votes: number };

export type PollView = {
  kind: 'poll';
  fen: string;
  prompt: string;
  lastMove: string | null; // highlighted on the board if set
  closesAt: number | null; // epoch ms; null = open forever
  totalVotes: number;
  myVote: string | null;
  // Hidden until the viewer has voted or the poll has closed.
  results: PollResult[] | null;
};

// Engine score from White's point of view.
export type EngineScore = { cp: number } | { mate: number };

// One entry per position in the game: index 0 is the start position, index i
// is the position after ply i. `best` is the engine's best move there (null
// when the game is over in that position).
export type ReviewPosition = { score: EngineScore; best: string | null };

export type ReviewAnalysis = {
  engine: string; // e.g. "Stockfish 19 lite"
  depth: number;
  positions: ReviewPosition[]; // length = plies + 1
};

export type ReviewView = {
  kind: 'review';
  pgn: string;
  white: string;
  black: string;
  result: string; // "1-0", "0-1", "1/2-1/2", "*"
  caption: string;
  author: string | null; // who requested the review
  // null until the first viewer's browser has run the engine and saved it.
  analysis: ReviewAnalysis | null;
  // True when the viewer is the author or a moderator, so POST
  // /api/review/reset will work for them.
  canReset?: boolean;
};

// Guess the Elo: a real rated Lichess game with player names removed.
export type EloGame = {
  pgn: string; // movetext only, no headers
  timeControl: string; // e.g. "600+0"
  result: string; // "1-0", "0-1", "1/2-1/2"
};

export type EloReveal = {
  white: number;
  black: number;
  average: number; // the target, rounded
  // Community guesses in 100-point buckets (bucket = lower bound).
  histogram: { bucket: number; count: number }[];
  totalGuesses: number;
};

export type EloView = {
  kind: 'elo';
  // curated = from the bundled Lichess set; lichess = a member's game fetched
  // from lichess.org (real ratings); selfReported = ratings from a pasted PGN.
  source: 'curated' | 'lichess' | 'selfReported';
  author: string | null; // member who posted it (null for curated)
  caption: string;
  number: number; // "Guess the Elo #N"
  game: EloGame;
  myGuess: number | null;
  myScore: number | null; // 0-100
  reveal: EloReveal | null; // null until the viewer has guessed
  me: { totalScore: number; games: number } | null; // null when logged out
};

// Community game: the subreddit plays itself (both sides), one voted move a
// day. Each day's post votes on the side to move; at the next posting time the
// move with the most votes is played (ties: the move that reached that count
// first) and a new post goes up. No votes keeps the same post open. When the
// game ends, the next post is a 'review' post of the whole game (author null).
export type GameView = {
  kind: 'game';
  gameNumber: number; // community game #N in this subreddit
  moveNumber: number; // full-move number being voted on
  fen: string; // position being voted on
  turn: 'white' | 'black';
  lastMove: string | null; // UCI of the previous move, highlighted
  moves: string[]; // UCI moves of the game before this vote
  // open: voting (no engine); closed: the winning move was played;
  // ended: a moderator ended the game while this post was open.
  status: 'open' | 'closed' | 'ended';
  totalVotes: number;
  myVote: string | null;
  // Hidden until the viewer has voted or the post is no longer open.
  results: PollResult[] | null;
  winningMove: { move: string; san: string } | null; // closed only
  nextPostId: string | null; // closed: the next post (next move or result)
};

export type PostView = PuzzleView | PollView | ReviewView | EloView | GameView;

export type SubredditFlags = {
  // r/AnarchyChess-style easter eggs (en passant jokes etc).
  anarchy: boolean;
};

// What the viewer may post from inside the app (the "+" sheet). All member
// posts share one daily limit and the sub's `memberPosts` setting.
export type CreateOptions = {
  review: boolean;
  elo: boolean;
  poll: boolean;
  remainingToday: number; // member posts left today (mods: unlimited = 99)
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string | null;
  post: PostView;
  flags: SubredditFlags;
  // True for subreddit moderators (show the create-poll button).
  canModerate: boolean;
  create: CreateOptions; // all false when logged out
};

// POST /api/puzzle/move. `moves` = all solver moves so far including the new
// one (UCI). The server verifies against the solution (any mate is accepted on
// the final move) and records the result itself: the first wrong move marks a
// failed first attempt; finishing marks solved. Logged out: allowed, nothing
// saved, and the response never includes solution/themes (a miss is just
// correct: false). Hint and reveal require login (401).
export type PuzzleMoveRequest = { moves: string[] };
export type PuzzleMoveResponse = {
  type: 'puzzleMove';
  correct: boolean;
  reply: string | null; // opponent's reply when correct and not done
  done: boolean; // puzzle finished
  // Present once the result is final for this viewer (done, or first miss):
  me: PuzzleMe | null;
  stats: PuzzleStats;
  ratingDelta: number; // non-zero only on the response that set the first attempt
  solution: string[] | null; // sent when done
  themes: string[] | null; // sent when done
};

// POST /api/puzzle/hint. Returns the next solver move for the given line and
// marks the attempt as hinted (no clean solve, counts as a loss for rating).
export type PuzzleHintRequest = { moves: string[] };
export type PuzzleHintResponse = { type: 'puzzleHint'; move: string };

// POST /api/puzzle/reveal. Gives up: records a failed first attempt if none
// exists, returns the full solution.
export type PuzzleRevealResponse = {
  type: 'puzzleReveal';
  solution: string[];
  themes: string[];
  me: PuzzleMe | null;
  stats: PuzzleStats;
  ratingDelta: number;
};

// POST /api/leaderboard/remove (moderators only). Removes a user from every
// leaderboard in the subreddit and stops them reappearing.
export type LeaderboardRemoveRequest = { username: string };
export type LeaderboardRemoveResponse = { type: 'leaderboardRemove' };

// POST /api/poll/vote. One vote per user, final. Server validates legality.
export type PollVoteRequest = { move: string };
export type PollVoteResponse = {
  type: 'pollVote';
  myVote: string;
  totalVotes: number;
  results: PollResult[];
};

// POST /api/review/analysis. The first valid submission is stored and served
// to every later viewer; later submissions return the stored one.
export type ReviewAnalysisRequest = ReviewAnalysis;
export type ReviewAnalysisResponse = {
  type: 'reviewAnalysis';
  analysis: ReviewAnalysis;
};

// POST /api/review/reset (no body). Author or moderator only; clears the
// stored analysis so the next viewer's engine run replaces it.
export type ReviewResetResponse = { type: 'reviewReset' };

// POST /api/poll/create. Mods always; members when the sub allows member posts
// (shares the member daily limit). Same result as the mod menu form.
export type PollCreateRequest = {
  fen: string; // FEN, PGN or lichess.org analysis link (required)
  prompt: string; // <= 200 chars
  closeHours: number; // 0 = never, max 168
  lastMove?: string | null; // UCI, highlighted on the board
};
export type PollCreateResponse = {
  type: 'pollCreate';
  postId: string;
  url: string;
};

// POST /api/elo/guess. One final guess per user, 400..3000 in steps of 25.
export type EloGuessRequest = { guess: number };
export type EloGuessResponse = {
  type: 'eloGuess';
  myGuess: number;
  myScore: number;
  reveal: EloReveal;
  percentile: number; // share of guessers (0-100) the viewer beat
};

// POST /api/review/create. Any member (unless the sub turned member reviews
// off). Accepts a PGN or a lichess.org game URL. Posts as the user.
export type ReviewCreateRequest = { pgnOrUrl: string; caption: string };
export type ReviewCreateResponse = {
  type: 'reviewCreate';
  postId: string;
  url: string;
};

// POST /api/elo/create. A member posts their own game for the sub to guess.
// Accepts a lichess.org game URL (ratings fetched) or a PGN with WhiteElo and
// BlackElo headers (marked self-reported). Player names are stripped.
export type EloCreateRequest = { pgnOrUrl: string; caption: string };
export type EloCreateResponse = {
  type: 'eloCreate';
  postId: string;
  url: string;
};

// POST /api/game/fetch. Logged in. Fetches a lichess.org game's PGN for the
// client (the webview cannot reach lichess.org itself).
export type GameFetchRequest = { url: string };
export type GameFetchResponse = { type: 'gameFetch'; pgn: string };

// POST /api/game/vote. Logged in, one final vote per post, open posts only.
export type GameVoteRequest = { move: string };
export type GameVoteResponse = {
  type: 'gameVote';
  myVote: string;
  totalVotes: number;
  results: PollResult[];
};

export type LeaderboardKind = 'streak' | 'rating' | 'solved' | 'elo';
export type LeaderboardEntry = {
  rank: number;
  username: string;
  value: number;
};
// GET /api/leaderboard?kind=streak|rating|solved|elo
export type LeaderboardResponse = {
  type: 'leaderboard';
  kind: LeaderboardKind;
  entries: LeaderboardEntry[]; // top 25
  me: LeaderboardEntry | null;
};

export type ErrorResponse = { type: 'error'; message: string };
