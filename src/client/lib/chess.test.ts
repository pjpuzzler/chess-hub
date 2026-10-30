import { describe, expect, it } from 'vitest';
import {
  buildLine,
  destsOf,
  parseMoveText,
  parsePgn,
  playMove,
  plyLabel,
  pvToSan,
  START_FEN,
} from './chess';

describe('chess helpers', () => {
  it('builds legal destinations', () => {
    const dests = destsOf(START_FEN);
    expect(dests.get('e2')).toEqual(['e3', 'e4']);
    expect(dests.get('g1')).toEqual(['f3', 'h3']);
    expect(dests.size).toBe(10);
  });

  it('flags en passant', () => {
    const fen =
      'rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    expect(playMove(fen, 'e5d6')).toMatchObject({
      san: 'exd6',
      enPassant: true,
    });
    expect(playMove(fen, 'e5e6')?.enPassant).toBe(false);
    expect(playMove(fen, 'e5e7')).toBeNull();
  });

  it('parses PGN with headers', () => {
    const parsed = parsePgn(
      '[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nc6 *'
    );
    expect(parsed?.startFen).toBe(START_FEN);
    expect(parsed?.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(parsePgn('1. e4 e5 2. Kxe8')).toBeNull();
  });

  it('builds a line and stops at an illegal move', () => {
    expect(
      buildLine(START_FEN, ['e2e4', 'e7e5', 'e1e3']).map((m) => m.san)
    ).toEqual(['e4', 'e5']);
  });

  it('numbers PVs from either side', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toBe(
      '1. e4 e5 2. Nf3'
    );
    const afterE4 =
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(pvToSan(afterE4, ['e7e5', 'g1f3'])).toBe('1... e5 2. Nf3');
  });

  it('labels plies', () => {
    expect(plyLabel(START_FEN, 0)).toEqual({ no: 1, white: true });
    expect(plyLabel(START_FEN, 3)).toEqual({ no: 2, white: false });
    expect(plyLabel('8/8/8/8/8/8/8/K6k b - - 0 24', 0)).toEqual({
      no: 24,
      white: false,
    });
  });

  it('parses typed SAN and UCI moves', () => {
    expect(parseMoveText(START_FEN, 'Nf3')).toBe('g1f3');
    expect(parseMoveText(START_FEN, ' e4!? ')).toBe('e2e4');
    expect(parseMoveText(START_FEN, 'G1F3')).toBe('g1f3');
    expect(parseMoveText(START_FEN, 'e5')).toBeNull();
    expect(parseMoveText('7k/4P3/8/8/8/8/8/K7 w - - 0 1', 'e8=N')).toBe(
      'e7e8n'
    );
    expect(parseMoveText('7k/4P3/8/8/8/8/8/K7 w - - 0 1', 'e7e8q')).toBe(
      'e7e8q'
    );
  });
});
