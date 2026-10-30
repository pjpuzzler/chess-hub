// Daily-puzzle streaks, counted over consecutive daily puzzle numbers.
//
// Each solved number n stores run(n) = length of the consecutive run ending at
// n. The streak is run(H) for the user's highest solved number H, shown only
// while H is the latest or previous puzzle. Only today's and yesterday's
// puzzles can be added, so a late add of yesterday can only extend today's run.

export type StreakState = {
  streak: number; // run ending at `last`
  best: number;
  last: number; // highest solved daily number (0 = none)
};

export const EMPTY_STREAK: StreakState = { streak: 0, best: 0, last: 0 };

export type SolveUpdate = {
  state: StreakState;
  run: number; // run(n) to store
  nextRun: number | null; // new run(n + 1), if n + 1 was already solved
};

/**
 * Add a solve of daily puzzle `n`, given run(n - 1) (0 if not solved) and
 * run(n + 1) (null if not solved). Caller ensures n was not solved before.
 */
export const applySolve = (
  state: StreakState,
  n: number,
  prevRun: number,
  nextRun: number | null
): SolveUpdate => {
  const run = prevRun + 1;
  const next = nextRun === null ? null : run + 1;
  const last = Math.max(state.last, n);
  const streak =
    last === n ? run : last === n + 1 && next !== null ? next : state.streak;
  return {
    state: { streak, best: Math.max(state.best, streak, run), last },
    run,
    nextRun: next,
  };
};

/**
 * Streak to show given the latest daily puzzle number. A streak is still alive
 * if the user solved the latest puzzle or the one before it (they can still
 * extend it); anything older has lapsed.
 */
export const displayStreak = (state: StreakState, latest: number): number =>
  state.last < latest - 1 ? 0 : state.streak;
