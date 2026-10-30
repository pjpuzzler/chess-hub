import { describe, expect, it } from 'vitest';
import {
  decodeVote,
  encodeVote,
  gameOutcome,
  outcomeText,
  pickWinner,
} from './game';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('pickWinner', () => {
  const v = (move: string, seq: number) => ({ move, seq });
  it('is null with no votes', () => {
    expect(pickWinner([])).toBeNull();
  });
  it('takes the most votes', () => {
    expect(pickWinner([v('e2e4', 1), v('d2d4', 2), v('d2d4', 3)])).toBe('d2d4');
  });
  it('breaks ties by whose deciding vote came first, whatever the input order', () => {
    // d4 gets its 2nd vote (seq 3) before e4 gets its 2nd (seq 4).
    const votes = [v('e2e4', 4), v('d2d4', 3), v('e2e4', 1), v('d2d4', 2)];
    expect(pickWinner(votes)).toBe('d2d4');
    expect(pickWinner([v('e2e4', 1), v('d2d4', 2)])).toBe('e2e4');
  });
  it('round-trips the stored vote format', () => {
    expect(decodeVote(encodeVote('e7e8q', 12))).toEqual({
      move: 'e7e8q',
      seq: 12,
    });
    expect(decodeVote('e2e4')).toBeNull();
  });
});

describe('gameOutcome', () => {
  it('detects checkmate with the right winner', () => {
    expect(gameOutcome(START, ['f2f3', 'e7e5', 'g2g4', 'd8h4'])).toEqual({
      result: '0-1',
      reason: 'checkmate',
    });
  });
  it('detects stalemate, insufficient material and the 50-move rule', () => {
    expect(gameOutcome('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', ['f7f6'])).toBeNull();
    expect(gameOutcome('7k/8/5QK1/8/8/8/8/8 w - - 0 1', ['f6f7'])).toEqual({
      result: '1/2-1/2',
      reason: 'stalemate',
    });
    expect(gameOutcome('7k/8/6K1/8/8/8/8/6n1 w - - 0 1', ['g6h6'])).toEqual({
      result: '1/2-1/2',
      reason: 'insufficient',
    });
    expect(gameOutcome('7k/8/6K1/8/8/8/R7/8 w - - 99 80', ['a2a3'])).toEqual({
      result: '1/2-1/2',
      reason: 'fiftyMove',
    });
  });
  it('detects threefold repetition over the whole game', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    expect(gameOutcome(START, [...shuffle, ...shuffle])).toEqual({
      result: '1/2-1/2',
      reason: 'threefold',
    });
    expect(gameOutcome(START, shuffle)).toBeNull();
  });
  it('words the outcome', () => {
    expect(outcomeText({ result: '1-0', reason: 'checkmate' }, 83)).toBe(
      'White wins by checkmate in 42'
    );
    expect(outcomeText({ result: '1/2-1/2', reason: 'threefold' }, 8)).toBe(
      'Draw by threefold repetition in 4'
    );
  });
});
