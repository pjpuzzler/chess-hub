import { describe, expect, it } from 'vitest';
import { parseGame, validateAnalysis } from '../../shared/chess/review';
import { terminalScore, toEngineScore } from './batch';

describe('review scoring helpers', () => {
  it('scores mate and stalemate positions in the form the server accepts', () => {
    const game = parseGame('1. f3 e5 2. g4 Qh4# 0-1');
    if ('error' in game) throw new Error(game.error);
    const last = game.fens[game.fens.length - 1] ?? '';
    expect(terminalScore(last)).toEqual({ mate: -1 }); // White is mated
    expect(terminalScore('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ cp: 0 });
    const positions = game.fens.map((fen, i) =>
      i === game.fens.length - 1
        ? { score: terminalScore(fen), best: null }
        : { score: { cp: 0 }, best: game.moves[i] ?? null }
    );
    expect(
      validateAnalysis({ engine: 'sf', depth: 14, positions }, game.fens)
    ).not.toHaveProperty('error');
  });

  it('clamps centipawns to the validator bound', () => {
    expect(toEngineScore({ cp: 25000 })).toEqual({ cp: 10000 });
    expect(toEngineScore({ mate: -3 })).toEqual({ mate: -3 });
  });
});
