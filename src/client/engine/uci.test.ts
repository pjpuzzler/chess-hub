import { describe, expect, it } from 'vitest';
import { formatScore, parseInfo, whiteShare } from './uci';

describe('parseInfo', () => {
  const line =
    'info depth 14 seldepth 20 multipv 2 score cp -35 nodes 12345 nps 100000 time 120 pv e7e5 g1f3 b8c6';

  it('reads depth, multipv, score and pv', () => {
    expect(parseInfo(line, true)).toEqual({
      multipv: 2,
      depth: 14,
      score: { cp: -35 },
      pv: ['e7e5', 'g1f3', 'b8c6'],
    });
  });

  it("flips the score to White's view when Black is to move", () => {
    expect(parseInfo(line, false)?.score).toEqual({ cp: 35 });
    expect(
      parseInfo('info depth 9 score mate 3 pv a1a8', false)?.score
    ).toEqual({ mate: -3 });
  });

  it('skips bounds, non-pv and junk lines', () => {
    expect(
      parseInfo('info depth 9 score cp 20 lowerbound pv e2e4', true)
    ).toBeNull();
    expect(parseInfo('info string NNUE evaluation enabled', true)).toBeNull();
    expect(parseInfo('bestmove e2e4 ponder e7e5', true)).toBeNull();
    expect(
      parseInfo('info depth 3 currmove e2e4 currmovenumber 1', true)
    ).toBeNull();
  });
});

describe('formatScore', () => {
  it('formats centipawns', () => {
    expect(formatScore({ cp: 123 })).toBe('+1.2');
    expect(formatScore({ cp: -48 })).toBe('-0.5');
    expect(formatScore({ cp: 2 })).toBe('0.0');
  });
  it('formats mates', () => {
    expect(formatScore({ mate: 3 })).toBe('M3');
    expect(formatScore({ mate: -2 })).toBe('-M2');
  });
});

describe('whiteShare', () => {
  it('is balanced at 0 and saturates for mates', () => {
    expect(whiteShare({ cp: 0 })).toBeCloseTo(0.5);
    expect(whiteShare({ cp: 300 })).toBeGreaterThan(0.7);
    expect(whiteShare({ cp: -300 })).toBeLessThan(0.3);
    expect(whiteShare({ mate: 1 })).toBe(1);
    expect(whiteShare({ mate: -1 })).toBe(0);
  });
});
