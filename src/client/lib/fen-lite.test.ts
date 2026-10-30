import { describe, expect, it } from 'vitest';
import { piecesFromFen, sideToMove, squarePosition } from './fen-lite';

describe('fen-lite', () => {
  it('places all 32 pieces of the start position', () => {
    const pieces = piecesFromFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    );
    expect(pieces).toHaveLength(32);
    expect(pieces).toContainEqual({
      role: 'king',
      color: 'white',
      file: 4,
      rank: 0,
    });
    expect(pieces).toContainEqual({
      role: 'queen',
      color: 'black',
      file: 3,
      rank: 7,
    });
  });
  it('reads the side to move', () => {
    expect(sideToMove('8/8/8/8/8/8/8/K6k b - - 0 1')).toBe('black');
    expect(sideToMove('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe('white');
  });
  it('flips squares for Black', () => {
    expect(squarePosition(0, 0, 'white')).toEqual({ left: 0, top: 87.5 });
    expect(squarePosition(0, 0, 'black')).toEqual({ left: 87.5, top: 0 });
  });
});
