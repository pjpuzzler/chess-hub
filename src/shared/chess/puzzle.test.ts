import { describe, expect, it } from 'vitest';
import {
  fenAtPly,
  hintFor,
  isSolverPly,
  parseUci,
  playUci,
  solverColor,
  stepPuzzle,
} from './puzzle';

// Lichess puzzle 00008 (CC0): three solver moves, no mate.
const LONG = {
  fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
  moves: ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'],
};
// Lichess puzzle 00sHx (CC0): ends in mate.
const MATE = {
  fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17',
  moves: ['e8d7', 'a2e6', 'd7d8', 'f7f8'],
};
// Back rank: after Kg8 both Ra8# and Qd8# mate; the solution says Ra8.
const TWO_MATES = {
  fen: '5k2/5ppp/8/8/8/8/5PPP/R2Q2K1 b - - 0 1',
  moves: ['f8g8', 'a1a8'],
};

describe('parseUci', () => {
  it('parses plain and promotion moves', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });
  it('rejects junk', () => {
    expect(parseUci('e2e9')).toBeNull();
    expect(parseUci('e7e8k')).toBeNull();
    expect(parseUci('')).toBeNull();
  });
});

describe('playUci', () => {
  it('returns null for illegal moves', () => {
    expect(playUci(LONG.fen, 'a8a1')).toBeNull();
  });
});

describe('solverColor', () => {
  it('is the side to move after the setup move', () => {
    expect(solverColor(LONG.fen)).toBe('white');
    expect(solverColor(TWO_MATES.fen)).toBe('white');
    expect(solverColor('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe('black');
  });
});

describe('stepPuzzle', () => {
  it('walks a full solution with opponent replies', () => {
    let ply = 1;
    let fen = fenAtPly(LONG.fen, LONG.moves, ply);
    const r1 = stepPuzzle(LONG.moves, ply, fen, 'e6e7');
    expect(r1).toEqual({ kind: 'continue', reply: 'b2b1', nextPly: 3 });
    ply = 3;
    fen = fenAtPly(LONG.fen, LONG.moves, ply);
    expect(stepPuzzle(LONG.moves, ply, fen, 'b3c1')).toEqual({
      kind: 'continue',
      reply: 'b1c1',
      nextPly: 5,
    });
    ply = 5;
    fen = fenAtPly(LONG.fen, LONG.moves, ply);
    expect(stepPuzzle(LONG.moves, ply, fen, 'h6c1')).toEqual({
      kind: 'solved',
    });
  });

  it('rejects a legal but wrong move', () => {
    const fen = fenAtPly(LONG.fen, LONG.moves, 1);
    expect(stepPuzzle(LONG.moves, 1, fen, 'h6h7')).toEqual({ kind: 'wrong' });
  });

  it('rejects an illegal move', () => {
    const fen = fenAtPly(LONG.fen, LONG.moves, 1);
    expect(stepPuzzle(LONG.moves, 1, fen, 'a1a8')).toEqual({ kind: 'wrong' });
  });

  it('solves on the final mating move', () => {
    const fen = fenAtPly(MATE.fen, MATE.moves, 3);
    expect(stepPuzzle(MATE.moves, 3, fen, 'f7f8')).toEqual({ kind: 'solved' });
  });

  it('accepts an alternative checkmate', () => {
    const fen = fenAtPly(TWO_MATES.fen, TWO_MATES.moves, 1);
    expect(stepPuzzle(TWO_MATES.moves, 1, fen, 'd1d8')).toEqual({
      kind: 'solved',
    });
    expect(stepPuzzle(TWO_MATES.moves, 1, fen, 'a1a8')).toEqual({
      kind: 'solved',
    });
    expect(stepPuzzle(TWO_MATES.moves, 1, fen, 'd1d7')).toEqual({
      kind: 'wrong',
    });
  });

  it('treats an underpromotion as wrong unless it mates', () => {
    const fen = '7k/4P3/8/8/8/8/8/K7 w - - 0 1';
    const moves = ['a2a1', 'e7e8q', 'h8h7'];
    expect(stepPuzzle(moves, 1, fen, 'e7e8r')).toEqual({ kind: 'wrong' });
    expect(stepPuzzle(moves, 1, fen, 'e7e8q')).toEqual({
      kind: 'continue',
      reply: 'h8h7',
      nextPly: 3,
    });
  });
});

describe('hints and plies', () => {
  it('returns the expected move for a hint', () => {
    expect(hintFor(LONG.moves, 1)).toEqual({ from: 'e6', to: 'e7' });
    expect(hintFor(LONG.moves, 99)).toBeNull();
  });
  it('identifies solver plies', () => {
    expect(isSolverPly(0)).toBe(false);
    expect(isSolverPly(1)).toBe(true);
    expect(isSolverPly(4)).toBe(false);
  });
});
