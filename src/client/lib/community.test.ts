import { describe, expect, it } from 'vitest';
import { eloLabel, gameLabel } from './community';

describe('post labels', () => {
  it('numbers curated Guess the Elo posts; members get "Guess my Elo"', () => {
    expect(eloLabel(7)).toBe('Guess the Elo #7');
    expect(eloLabel(7, true)).toBe('Elo #7');
    expect(eloLabel(0)).toBe('Guess my Elo');
    expect(eloLabel(0, true)).toBe('Guess my Elo');
  });

  it('leaves "#1" off the first community game', () => {
    expect(gameLabel(1)).toBe('Community game');
    expect(gameLabel(2)).toBe('Community game #2');
  });
});
