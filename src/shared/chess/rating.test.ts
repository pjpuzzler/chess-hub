import { describe, expect, it } from 'vitest';
import { expectedScore, START_RATING, updateRating } from './rating';

describe('rating', () => {
  it('expects 50% against an equal rating', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
  });

  it('gives +16 / -16 for a win / loss against an equal puzzle', () => {
    expect(updateRating(START_RATING, 1500, 1)).toEqual({
      rating: 1516,
      delta: 16,
    });
    expect(updateRating(START_RATING, 1500, 0)).toEqual({
      rating: 1484,
      delta: -16,
    });
  });

  it('rewards beating a much harder puzzle and barely rewards an easy one', () => {
    expect(updateRating(1500, 2100, 1).delta).toBe(31); // 32 * (1 - 0.0307)
    expect(updateRating(1500, 900, 1).delta).toBe(1); // 32 * (1 - 0.9693)
    expect(updateRating(1500, 900, 0).delta).toBe(-31);
  });

  it('is zero-sum in expectation and uses integer deltas', () => {
    const { delta } = updateRating(1623, 1411, 0);
    expect(Number.isInteger(delta)).toBe(true);
    expect(delta).toBeLessThan(0);
  });
});
