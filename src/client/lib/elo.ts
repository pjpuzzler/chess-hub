// Guess the Elo helpers (pure).
export const ELO_MIN = 400;
export const ELO_MAX = 3000;
export const ELO_STEP = 25;

export const clampGuess = (n: number) =>
  Math.min(ELO_MAX, Math.max(ELO_MIN, Math.round(n / ELO_STEP) * ELO_STEP));

// Share of other guessers (0-100) whose bucket centre was further from the
// answer than the viewer's guess. Used when the server's exact percentile
// isn't available (e.g. after a reload).
export function beatPercent(
  histogram: readonly { bucket: number; count: number }[],
  average: number,
  guess: number
): number {
  const mine = Math.abs(guess - average);
  let worse = 0;
  let total = 0;
  for (const { bucket, count } of histogram) {
    total += count;
    if (Math.abs(bucket + 50 - average) > mine) worse += count;
  }
  // The viewer's own guess is in the histogram; don't count it.
  total = Math.max(0, total - 1);
  return total > 0 ? Math.round((100 * Math.min(worse, total)) / total) : 100;
}
