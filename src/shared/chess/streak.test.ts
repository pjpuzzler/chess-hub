import { describe, expect, it } from 'vitest';
import {
  applySolve,
  displayStreak,
  EMPTY_STREAK,
  type StreakState,
} from './streak';

const state = (streak: number, last: number, best = streak): StreakState => ({
  streak,
  best,
  last,
});

describe('streak', () => {
  it('starts at 1 from nothing', () => {
    expect(applySolve(EMPTY_STREAK, 1, 0, null)).toEqual({
      state: state(1, 1),
      run: 1,
      nextRun: null,
    });
  });

  it('extends on the next consecutive number', () => {
    expect(applySolve(state(3, 7), 8, 3, null).state).toEqual(state(4, 8));
  });

  it('restarts at 1 after a gap, keeping best', () => {
    expect(applySolve(state(5, 7, 5), 10, 0, null).state).toEqual({
      streak: 1,
      best: 5,
      last: 10,
    });
  });

  it("solving yesterday's after today's joins the runs instead of killing them", () => {
    // Solved 1..5, skipped nothing; today is 7, solved 7 first (run 1), then 6.
    const afterToday = applySolve(state(5, 5), 7, 0, null).state;
    expect(afterToday).toEqual({ streak: 1, best: 5, last: 7 });
    const afterYesterday = applySolve(afterToday, 6, 5, 1);
    expect(afterYesterday).toEqual({
      state: { streak: 7, best: 7, last: 7 },
      run: 6,
      nextRun: 7,
    });
  });

  it('shows 0 once the user has missed a full puzzle', () => {
    const s = state(4, 10);
    expect(displayStreak(s, 10)).toBe(4);
    expect(displayStreak(s, 11)).toBe(4);
    expect(displayStreak(s, 12)).toBe(0);
  });
});
