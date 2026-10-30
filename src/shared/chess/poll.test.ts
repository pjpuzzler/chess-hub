import { describe, expect, it } from 'vitest';
import {
  checkMove,
  fenFromLichessUrl,
  hasLegalMoves,
  parsePosition,
  playUci,
  tally,
} from './poll';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parsePosition', () => {
  it('parses a FEN, including one without move counters', () => {
    const p = parsePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
    );
    expect(p).toMatchObject({
      fen: START,
      pgn: null,
      lastMove: null,
      turn: 'white',
    });
  });

  it('parses a PGN to its final position and last move', () => {
    const p = parsePosition('1. e4 e5 2. Nf3 {develop} Nc6');
    if ('error' in p) throw new Error(p.error);
    expect(p.lastMove).toBe('b8c6');
    expect(p.turn).toBe('white');
    expect(p.startFen).toBe(START);
    expect(p.pgn).toContain('Nf3');
  });

  it('uses the FEN header of a PGN as the start position', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const p = parsePosition(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 *`);
    if ('error' in p) throw new Error(p.error);
    expect(p.startFen).toBe(fen);
    expect(p.lastMove).toBe('e2e4');
  });

  it('rejects junk, empty input and illegal FENs', () => {
    expect(parsePosition('hello world')).toHaveProperty('error');
    expect(parsePosition('8/8/8/8/8/8/8/8 w - - 0 1')).toHaveProperty('error');
    expect(parsePosition('1. e4 e5 2. Ke3 Ke6 3. Qh5')).toHaveProperty('error');
  });
});

describe('parsePosition extras', () => {
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  it('requires a position', () => {
    for (const blank of ['', '   \n'])
      expect(parsePosition(blank)).toEqual({
        error: 'Enter a FEN, a PGN or a lichess.org analysis link.',
      });
  });
  it('extracts a FEN from lichess analysis and editor URLs', () => {
    const tail = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR_b_KQkq_e3_0_1';
    for (const url of [
      `https://lichess.org/analysis/${tail}`,
      `https://lichess.org/analysis/${tail}?color=black#12`,
      `https://www.lichess.org/editor/${tail}`,
      `lichess.org/analysis/standard/${tail}`,
      `https://lichess.org/analysis/${tail.replace(/_/g, '%20')}`,
    ]) {
      expect(parsePosition(url), url).toMatchObject({
        fen: afterE4,
        turn: 'black',
      });
    }
    expect(fenFromLichessUrl('https://lichess.org/analysis')).toBeNull();
    expect(parsePosition('https://lichess.org/analysis/junk')).toHaveProperty(
      'error'
    );
    expect(
      parsePosition(
        'https://example.com/analysis/' + afterE4.replace(/ /g, '_')
      )
    ).toHaveProperty('error');
  });
});

describe('moves', () => {
  it('checks legality and returns SAN', () => {
    expect(checkMove(START, 'e2e4')).toEqual({ uci: 'e2e4', san: 'e4' });
    expect(checkMove(START, 'e2e5')).toBeNull();
    expect(checkMove(START, 'e7e5')).toBeNull(); // wrong side
    expect(checkMove(START, 'nonsense')).toBeNull();
  });

  it('requires a promotion piece and normalises it', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    expect(checkMove(fen, 'a7a8')).toBeNull();
    expect(checkMove(fen, 'a7a8q')).toEqual({ uci: 'a7a8q', san: 'a8=Q' });
  });

  it('plays a move and detects no legal moves', () => {
    expect(playUci(START, 'e2e4')).toContain('4P3');
    expect(playUci(START, 'e2e5')).toBeNull();
    expect(hasLegalMoves(START)).toBe(true);
    expect(hasLegalMoves('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe(false); // mated
  });
});

describe('tally', () => {
  it('sorts by votes then SAN and drops illegal or empty entries', () => {
    const out = tally(START, { e2e4: 3, d2d4: 3, g1f3: 5, a1a5: 9, c2c4: 0 });
    expect(out.map((r) => r.san)).toEqual(['Nf3', 'd4', 'e4']);
    expect(out[0]).toEqual({ move: 'g1f3', san: 'Nf3', votes: 5 });
  });
});
