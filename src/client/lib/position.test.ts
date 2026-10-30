import { describe, expect, it } from 'vitest';
import { editorFen, positionProblem } from './position';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('board editor positions', () => {
  it('builds a FEN with the castling rights the placement allows', () => {
    expect(editorFen(START, 'white')).toBe(`${START} w KQkq - 0 1`);
    expect(editorFen('4k3/8/8/8/8/8/8/R3K3', 'black')).toBe(
      '4k3/8/8/8/8/8/8/R3K3 b Q - 0 1'
    );
  });
  it('accepts normal positions', () => {
    expect(positionProblem(START, 'white')).toBeNull();
    expect(positionProblem('4k3/8/8/8/8/8/4P3/4K3', 'black')).toBeNull();
  });
  it('rejects illegal setups', () => {
    expect(positionProblem('8/8/8/8/8/8/8/4K3', 'white')).toMatch(/one king/);
    expect(positionProblem('4k3/8/8/8/8/8/8/P3K3', 'white')).toMatch(/Pawns/);
    // Black king attacked by the white rook, but it's White's move.
    expect(positionProblem('4k3/8/8/8/8/8/8/4RK2', 'white')).toMatch(
      /Black is in check/
    );
    expect(positionProblem('k1K5/8/1Q6/8/8/8/8/8', 'black')).toMatch(
      /stalemate|checkmate/
    );
  });
});
