import { describe, expect, it } from 'vitest';
import { beatPercent, clampGuess } from './elo';

describe('elo helpers', () => {
  it('clamps and snaps guesses', () => {
    expect(clampGuess(1234)).toBe(1225);
    expect(clampGuess(100)).toBe(400);
    expect(clampGuess(5000)).toBe(3000);
  });
  it('estimates the share of guessers beaten', () => {
    const hist = [
      { bucket: 1000, count: 10 },
      { bucket: 1800, count: 5 },
      { bucket: 2400, count: 6 },
    ];
    // answer 1850, guess 1825: only the 1800 bucket (centre 1850) is as close.
    expect(beatPercent(hist, 1850, 1825)).toBe(80);
    expect(beatPercent([], 1500, 1500)).toBe(100);
  });
});
