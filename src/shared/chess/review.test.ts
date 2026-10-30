import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { ReviewPosition } from '../api';
import {
  classifyPly,
  gameAccuracy,
  moveAccuracy,
  parseGame,
  summarizeReview,
  isBrilliant,
  sacrificedMaterial,
  validateAnalysis,
  winPercent,
} from './review';

const pos = (cp: number, best: string | null = 'e2e4'): ReviewPosition => ({
  score: { cp },
  best,
});

describe('winPercent', () => {
  it('matches the Lichess curve', () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    expect(winPercent({ cp: 100 })).toBeCloseTo(59.1, 1);
    expect(winPercent({ cp: -100 })).toBeCloseTo(40.9, 1);
    expect(winPercent({ cp: 1000 })).toBeGreaterThan(97);
  });
  it('treats mates as certain', () => {
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -1 })).toBe(0);
  });
});

describe('classifyPly', () => {
  it('is best when the engine move was played, whatever the noise', () => {
    expect(classifyPly(pos(0, 'e2e4'), pos(-80), 'e2e4', 'white').cls).toBe(
      'best'
    );
  });
  it('calls the engine pick a blunder when the next position refutes it', () => {
    // 8...Nxe4 in Reti-Tartakower: shallow best, then mate in 3 for White.
    expect(
      classifyPly(
        pos(83, 'f6e4'),
        { score: { mate: 3 }, best: 'd3d8' },
        'f6e4',
        'black'
      ).cls
    ).toBe('blunder');
  });
  it('gives no ?! or ? while the mover stays clearly winning', () => {
    expect(classifyPly(pos(1200), pos(700), 'a2a3', 'white').cls).toBe('good');
    expect(classifyPly(pos(150), pos(20), 'a2a3', 'white').cls).toBe('mistake');
  });
  it('bands by win% loss from the mover side', () => {
    const c = (afterCp: number, side: 'white' | 'black' = 'white') =>
      classifyPly(pos(0), pos(afterCp), 'a2a3', side).cls;
    expect(c(-10)).toBe('excellent'); // loses ~0.9 win% points
    expect(c(-30)).toBe('good'); // ~2.8
    expect(c(-100)).toBe('inaccuracy'); // ~9.1
    expect(c(-150)).toBe('mistake'); // ~13.5
    expect(c(-300)).toBe('blunder'); // ~25
    // Black loses when the White-POV score rises.
    expect(c(600, 'black')).toBe('blunder');
    expect(c(600, 'white')).toBe('excellent'); // improving is never a loss
  });
  it('flags a lost forced mate', () => {
    const r = classifyPly(
      { score: { mate: 2 }, best: 'd1h5' },
      pos(150),
      'a2a3',
      'white'
    );
    expect(r.cls).toBe('missedMate');
    expect(
      classifyPly(
        { score: { mate: -2 }, best: 'x' },
        pos(-300),
        'a7a6',
        'black'
      ).cls
    ).toBe('missedMate');
  });
  it('keeps a mate that is merely slower', () => {
    const r = classifyPly(
      { score: { mate: 2 }, best: 'd1h5' },
      { score: { mate: 4 }, best: 'x' },
      'a2a3',
      'white'
    );
    expect(r.cls).not.toBe('missedMate');
  });
});

describe('accuracy', () => {
  it('is ~100 for no loss and falls with the loss', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(50, 60)).toBe(100); // gains clamp to no loss
    expect(moveAccuracy(50, 40)).toBeCloseTo(64.7, 0);
    expect(moveAccuracy(90, 10)).toBeLessThan(5);
  });
  it('scores a flat game at 100 and punishes one side only', () => {
    const flat = Array.from({ length: 11 }, () => pos(0));
    expect(gameAccuracy(flat, 'white')).toEqual({ white: 100, black: 100 });
    // White blunders on ply 1, then nothing changes.
    const bad = [
      pos(0),
      pos(-500),
      ...Array.from({ length: 9 }, () => pos(-500)),
    ];
    const acc = gameAccuracy(bad, 'white');
    expect(acc.white).toBeLessThan(80);
    expect(acc.black).toBe(100);
  });
  it('is null for a side that never moved', () => {
    expect(gameAccuracy([pos(0), pos(0)], 'white')).toEqual({
      white: 100,
      black: null,
    });
  });
});

describe('summarizeReview', () => {
  it('counts classes per side', () => {
    const positions = [
      pos(0, 'e2e4'),
      pos(20, 'e7e5'),
      pos(400, 'g1f3'),
      pos(400, 'x'),
    ];
    const s = summarizeReview(positions, ['e2e4', 'a7a6', 'h2h3'], 'white');
    expect(s.counts.white.best).toBe(1);
    expect(s.counts.black.blunder).toBe(1);
    expect(s.counts.white.excellent).toBe(1);
    expect(s.plies.map((p) => p.cls)).toEqual(['best', 'blunder', 'excellent']);
  });
});

const GAME =
  '[White "Ann"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 {best} e5 (1... c5) 2. Nf3 Nc6 1-0';

describe('parseGame', () => {
  it('parses headers, strips comments and variations', () => {
    const g = parseGame(GAME);
    if ('error' in g) throw new Error(g.error);
    expect(g).toMatchObject({
      white: 'Ann',
      black: 'Bob',
      result: '1-0',
      firstMover: 'white',
    });
    expect(g.moves).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(g.fens).toHaveLength(5);
    expect(g.pgn).not.toContain('best');
    expect(g.pgn).not.toContain('c5');
  });
  it('rejects junk, empty games and over-long games', () => {
    expect(parseGame('')).toHaveProperty('error');
    expect(parseGame('banana')).toHaveProperty('error');
    expect(parseGame('[Event "x"]\n\n*')).toHaveProperty('error');
    // 301 plies: shuffle knights.
    const c = new Chess();
    for (let i = 0; i < 301; i++) {
      const cyc = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
      c.move(cyc[i % 4] as string);
    }
    // threefold repetition does not stop chess.js move generation
    expect(parseGame(c.pgn())).toMatchObject({
      error: expect.stringContaining('limit'),
    });
  });
});

describe('validateAnalysis', () => {
  const g = parseGame(GAME);
  if ('error' in g) throw new Error(g.error);
  const good = () => ({
    engine: 'Stockfish 19 lite',
    depth: 12,
    positions: g.fens.map((fen) => ({
      score: { cp: 10 },
      best:
        new Chess(fen)
          .moves({ verbose: true })
          .map((m) => `${m.from}${m.to}`)[0] ?? null,
    })),
  });
  const bad = (mut: (a: ReturnType<typeof good>) => unknown) => {
    const a = good();
    return validateAnalysis(mut(a) ?? a, g.fens);
  };

  it('accepts a valid analysis and rebuilds it without extras', () => {
    const a = good();
    const r = validateAnalysis({ ...a, extra: 1 }, g.fens);
    expect(r).toEqual(a);
  });
  it('rejects bad shapes', () => {
    expect(
      bad((a) => {
        a.positions.pop();
      })
    ).toHaveProperty('error');
    expect(
      bad((a) => {
        a.depth = 7;
      })
    ).toHaveProperty('error');
    expect(
      bad((a) => {
        a.depth = 41;
      })
    ).toHaveProperty('error');
    expect(
      bad((a) => {
        a.depth = 12.5;
      })
    ).toHaveProperty('error');
    expect(
      bad((a) => {
        a.engine = 'x'.repeat(41);
      })
    ).toHaveProperty('error');
    expect(
      bad((a) => {
        a.engine = '';
      })
    ).toHaveProperty('error');
    expect(validateAnalysis(null, g.fens)).toHaveProperty('error');
  });
  it('rejects bad scores', () => {
    const withScore = (score: unknown) =>
      bad((a) => {
        (a.positions[1] as { score: unknown }).score = score;
      });
    expect(withScore({ cp: 10001 })).toHaveProperty('error');
    expect(withScore({ cp: NaN })).toHaveProperty('error');
    expect(withScore({ cp: Infinity })).toHaveProperty('error');
    expect(withScore({ mate: 0 })).toHaveProperty('error');
    expect(withScore({ mate: 1.5 })).toHaveProperty('error');
    expect(withScore({ cp: 1, mate: 2 })).toHaveProperty('error');
    expect(withScore({})).toHaveProperty('error');
    expect(withScore({ mate: -3 })).not.toHaveProperty('error');
  });
  it('rejects illegal, missing or unexpected best moves', () => {
    const withBest = (best: unknown) =>
      bad((a) => {
        (a.positions[0] as { best: unknown }).best = best;
      });
    expect(withBest('e2e5')).toHaveProperty('error');
    expect(withBest(null)).toHaveProperty('error'); // not terminal
    expect(withBest(5)).toHaveProperty('error');
  });
  it('allows null best only in terminal positions', () => {
    const mate = parseGame('1. f3 e5 2. g4 Qh4# 0-1');
    if ('error' in mate) throw new Error(mate.error);
    const positions = mate.fens.map((fen, i) => ({
      score: i === mate.fens.length - 1 ? { mate: -1 } : { cp: 0 },
      best:
        new Chess(fen)
          .moves({ verbose: true })
          .map((m) => `${m.from}${m.to}`)[0] ?? null,
    }));
    const a = { engine: 'sf', depth: 10, positions };
    expect(validateAnalysis(a, mate.fens)).toEqual(a);
    expect(positions[positions.length - 1]?.best).toBeNull();
    const withBest = {
      ...a,
      positions: positions.map((p, i) =>
        i === positions.length - 1 ? { ...p, best: 'a2a3' } : p
      ),
    };
    expect(validateAnalysis(withBest, mate.fens)).toHaveProperty('error');
  });

  const mateGame = parseGame('1. f3 e5 2. g4 Qh4# 0-1');
  if ('error' in mateGame) throw new Error(mateGame.error);
  const withLast = (score: unknown) => ({
    engine: 'sf',
    depth: 10,
    positions: mateGame.fens.map((fen, i) => ({
      score: i === mateGame.fens.length - 1 ? score : { cp: 0 },
      best:
        new Chess(fen)
          .moves({ verbose: true })
          .map((m) => `${m.from}${m.to}`)[0] ?? null,
    })),
  });

  it('requires a mate score with the right sign on a checkmated position', () => {
    // White is mated, so the score must be negative.
    expect(validateAnalysis(withLast({ cp: 0 }), mateGame.fens)).toHaveProperty(
      'error'
    );
    expect(
      validateAnalysis(withLast({ cp: -900 }), mateGame.fens)
    ).toHaveProperty('error');
    expect(
      validateAnalysis(withLast({ mate: 1 }), mateGame.fens)
    ).toHaveProperty('error');
    expect(
      validateAnalysis(withLast({ mate: -1 }), mateGame.fens)
    ).not.toHaveProperty('error');
  });

  it('requires cp 0 for stalemate and dead positions', () => {
    const fens = [
      '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
      '8/8/8/4k3/8/8/3K4/8 w - - 0 1',
    ];
    const mk = (score: unknown, i: number) => ({
      engine: 'sf',
      depth: 10,
      positions: fens.map((fen, j) => ({
        score: j === i ? score : { cp: 0 },
        best:
          new Chess(fen)
            .moves({ verbose: true })
            .map((m) => `${m.from}${m.to}`)[0] ?? null,
      })),
    });
    for (const i of [0, 1]) {
      expect(validateAnalysis(mk({ cp: 50 }, i), fens)).toHaveProperty('error');
      expect(validateAnalysis(mk({ mate: 2 }, i), fens)).toHaveProperty(
        'error'
      );
      expect(validateAnalysis(mk({ cp: 0 }, i), fens)).not.toHaveProperty(
        'error'
      );
    }
  });
});

describe('brilliant moves', () => {
  // Constructed positions, one rule property per test. White to move with a
  // rook it can put en prise on d4 (Rd4 cxd4).
  const SAC = '6k1/5ppp/8/2p5/8/8/5PPP/3R2K1 w - - 0 1';
  const base = {
    fenBefore: SAC,
    move: 'd1d4',
    prev: null,
    ply: 30,
    before: { score: { cp: 50 }, best: 'd1d4' },
    after: { score: { cp: 50 }, best: 'c5d4' },
    side: 'white' as const,
    loss: 0,
  };
  const after = (fen: string, uci: string): string => {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    return c.fen();
  };

  it('measures the material the opponent can win from the moved piece', () => {
    expect(sacrificedMaterial(SAC, 'd1d4')).toBe(5);
    // A rook move nothing can take sacrifices nothing.
    expect(sacrificedMaterial(SAC, 'd1d7')).toBe(0);
    expect(isBrilliant({ ...base, move: 'd1d7' })).toBe(false);
  });
  it('marks a sound sacrifice in a balanced position', () => {
    expect(isBrilliant(base)).toBe(true);
  });
  it('allows at most 2 win% below the best move', () => {
    expect(isBrilliant({ ...base, loss: 2 })).toBe(true);
    expect(isBrilliant({ ...base, loss: 2.1 })).toBe(false);
  });
  it('needs the mover below 90% before, with no exception for mates', () => {
    expect(
      isBrilliant({ ...base, before: { score: { cp: 700 }, best: 'd1d4' } })
    ).toBe(false);
    expect(
      isBrilliant({ ...base, before: { score: { mate: 3 }, best: 'd1d4' } })
    ).toBe(false);
  });
  it('needs the mover at least level afterwards', () => {
    expect(
      isBrilliant({ ...base, after: { score: { cp: 0 }, best: 'c5d4' } })
    ).toBe(true);
    expect(
      isBrilliant({ ...base, after: { score: { cp: -20 }, best: 'c5d4' } })
    ).toBe(false);
  });
  it('is never awarded in the first 8 plies', () => {
    expect(isBrilliant({ ...base, ply: 8 })).toBe(false);
    expect(isBrilliant({ ...base, ply: 9 })).toBe(true);
  });
  it('ignores pieces that were already hanging', () => {
    // Kasparov-Topalov 36...Rd2: Qxd2+ Kxd2 Bxc4 looks like a loss for
    // Black, but the queen on c4 hangs to Bf1 whether or not the rook moves.
    const fen = '3r3r/1R3p1p/6p1/1p6/2q5/5PP1/1Q5P/1K1k1B2 b - - 5 36';
    expect(sacrificedMaterial(fen, 'd8d2')).toBe(0);
  });
  it('excludes recaptures but not taking a piece that just moved', () => {
    // Black's knight takes on d4 and White takes back, losing the exchange.
    const capture = '6k1/5ppp/8/1np5/3P4/8/5PPP/3R2K1 b - - 0 1';
    const recapture = {
      ...base,
      fenBefore: after(capture, 'b5d4'),
      prev: { fenBefore: capture, move: 'b5d4' },
    };
    expect(sacrificedMaterial(recapture.fenBefore, 'd1d4')).toBe(2);
    expect(isBrilliant(recapture)).toBe(false);
    // Same square, but the knight arrived without capturing.
    const quiet = '6k1/5ppp/8/1np5/8/8/5PPP/3R2K1 b - - 0 1';
    expect(
      isBrilliant({
        ...base,
        fenBefore: after(quiet, 'b5d4'),
        prev: { fenBefore: quiet, move: 'b5d4' },
      })
    ).toBe(true);
  });
});
