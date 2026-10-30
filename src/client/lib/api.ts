// Typed fetch helpers for the Chess Hub /api routes (contract: src/shared/api.ts).
import type {
  EloCreateRequest,
  EloCreateResponse,
  EloGuessRequest,
  GameFetchResponse,
  GameVoteRequest,
  GameVoteResponse,
  EloGuessResponse,
  InitResponse,
  LeaderboardKind,
  LeaderboardRemoveResponse,
  LeaderboardResponse,
  PollCreateRequest,
  PollCreateResponse,
  PollVoteRequest,
  PollVoteResponse,
  PuzzleHintResponse,
  PuzzleMoveResponse,
  PuzzleRevealResponse,
  ReviewAnalysisRequest,
  ReviewAnalysisResponse,
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewResetResponse,
} from '../../shared/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function errorMessage(data: unknown, status: number): string {
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message;
  }
  return `Request failed (${status})`;
}

function parseJson<T>(text: string): T | null {
  try {
    // JSON.parse returns `any`, so this is the single trust boundary for
    // response shapes (the server is ours and follows src/shared/api.ts).
    const data: T | null = text ? JSON.parse(text) : null;
    return data;
  } catch {
    return null;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = parseJson<T>(await res.text());
  if (!res.ok || data === null) {
    throw new ApiError(errorMessage(data, res.status), res.status);
  }
  return data;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  init: () => request<InitResponse>('/api/init'),
  puzzleMove: (moves: string[]) =>
    request<PuzzleMoveResponse>('/api/puzzle/move', post({ moves })),
  puzzleHint: (moves: string[]) =>
    request<PuzzleHintResponse>('/api/puzzle/hint', post({ moves })),
  puzzleReveal: () =>
    request<PuzzleRevealResponse>('/api/puzzle/reveal', post({})),
  pollVote: (body: PollVoteRequest) =>
    request<PollVoteResponse>('/api/poll/vote', post(body)),
  pollCreate: (body: PollCreateRequest) =>
    request<PollCreateResponse>('/api/poll/create', post(body)),
  reviewAnalysis: (body: ReviewAnalysisRequest) =>
    request<ReviewAnalysisResponse>('/api/review/analysis', post(body)),
  reviewReset: () =>
    request<ReviewResetResponse>('/api/review/reset', post({})),
  reviewCreate: (body: ReviewCreateRequest) =>
    request<ReviewCreateResponse>('/api/review/create', post(body)),
  eloGuess: (body: EloGuessRequest) =>
    request<EloGuessResponse>('/api/elo/guess', post(body)),
  eloCreate: (body: EloCreateRequest) =>
    request<EloCreateResponse>('/api/elo/create', post(body)),
  gameFetch: (url: string) =>
    request<GameFetchResponse>('/api/game/fetch', post({ url })),
  gameVote: (body: GameVoteRequest) =>
    request<GameVoteResponse>('/api/game/vote', post(body)),
  leaderboard: (kind: LeaderboardKind) =>
    request<LeaderboardResponse>(`/api/leaderboard?kind=${kind}`),
  leaderboardRemove: (username: string) =>
    request<LeaderboardRemoveResponse>(
      '/api/leaderboard/remove',
      post({ username })
    ),
};

// Text safe to show a user. Server messages for expected refusals (4xx) are
// written for people; anything else (5xx, network, dev errors) is not.
export function friendlyError(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.message.length <= 160 &&
    !/^Request failed/.test(err.message)
  ) {
    return err.message;
  }
  return 'Something went wrong. Try again.';
}
