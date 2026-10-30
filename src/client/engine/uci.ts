// Pure UCI parsing and eval formatting. Scores are normalised to White's view.
export { parseInfo, type PvLine, type Score } from '../../shared/chess/uci';
import type { Score } from '../../shared/chess/uci';

// "+1.2", "-0.4", "0.0", "M3" (White mates), "-M2" (Black mates).
export function formatScore(score: Score): string {
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return `${score.mate > 0 ? '' : '-'}M${Math.abs(score.mate)}`;
  }
  const pawns = score.cp / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

// White's share of the eval bar, 0..1 (Lichess-style winning chances curve).
export function whiteShare(score: Score): number {
  if (score.mate !== undefined)
    return score.mate > 0 ? 1 : score.mate < 0 ? 0 : 0.5;
  const cp = Math.max(-1000, Math.min(1000, score.cp));
  const chances = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return (chances + 1) / 2;
}
