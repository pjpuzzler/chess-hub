// Community game names, shared by the expanded view and the splash (regex
// only, so the splash bundle stays free of chess.js).
import type { ReviewView } from '../../shared/api';

const side = (s: 'white' | 'black') => (s === 'white' ? 'White' : 'Black');

/** "Community game #2 · Move 12 · White to play" (no "#1" for the first). */
export function gameLabel(gameNumber: number): string {
  return `Community game${gameNumber > 1 ? ` #${gameNumber}` : ''}`;
}

export function toPlay(turn: 'white' | 'black'): string {
  return `${side(turn)} to play`;
}

/**
 * A community game's result post is a review with no author and the
 * subreddit on both sides. Returns its names, or null for other reviews.
 * `full` is the PGN's Event ("r/AnarchyChess community game #2").
 */
export function communityReview(
  view: Pick<ReviewView, 'author' | 'white' | 'black' | 'pgn'>
): { short: string; full: string } | null {
  if (view.author !== null || view.white !== view.black) return null;
  const event = /\[Event "([^"]*community game[^"]*)"\]/.exec(view.pgn)?.[1];
  const n = event ? /#(\d+)/.exec(event)?.[1] : undefined;
  const short = gameLabel(n ? Number(n) : 1);
  return { short, full: event ?? `${view.white} ${short.toLowerCase()}` };
}
