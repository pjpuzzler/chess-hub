// Elo-style puzzle rating. The solver is "playing" the puzzle, whose rating is
// fixed (Lichess's), so only the user's rating moves.

export const START_RATING = 1500;
export const K_FACTOR = 32;
// Attempts needed before a user appears on the rating leaderboard.
export const MIN_RATED_ATTEMPTS = 5;

/** Probability (0..1) that a player rated `rating` beats an opponent rated `opponent`. */
export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

export type RatingUpdate = { rating: number; delta: number };

/**
 * New rating after one attempt. `score` is 1 for a clean solve, 0 for a
 * loss (miss or hint used). Delta is rounded to an integer.
 */
export const updateRating = (
  rating: number,
  puzzleRating: number,
  score: 0 | 1,
  k: number = K_FACTOR
): RatingUpdate => {
  const delta = Math.round(k * (score - expectedScore(rating, puzzleRating)));
  return { rating: rating + delta, delta };
};
