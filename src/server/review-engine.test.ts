// Regression test for Game Review chess correctness. Runs the real
// Stockfish 19 lite single-threaded engine (the same build the app ships)
// under Node through the shared review driver, then classifies the moves.
// Lives under src/server only because this project has Node types.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  parseGame,
  summarizeReview,
  winPercent,
  type ReviewSummary,
} from '../shared/chess/review';
import type { ReviewAnalysis } from '../shared/api';
import { analyzeGame, type UciEngine } from '../shared/chess/review-engine';

const require = createRequire(import.meta.url);
const enginePath: string = require('stockfish').findEngine('lite-single');

function nodeEngine(): { engine: UciEngine; close: () => void } {
  const child = spawn(process.execPath, [enginePath], { stdio: 'pipe' });
  const queue: string[] = [];
  let waiting: ((l: string) => void) | null = null;
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(line);
      } else queue.push(line);
    }
  });
  return {
    engine: {
      send: (cmd) => child.stdin.write(`${cmd}\n`),
      next: () => {
        const line = queue.shift();
        if (line !== undefined) return Promise.resolve(line);
        return new Promise((resolve) => (waiting = resolve));
      },
    },
    close: () => child.kill(),
  };
}

async function review(pgn: string) {
  const game = parseGame(pgn);
  if ('error' in game) throw new Error(game.error);
  const { engine, close } = nodeEngine();
  try {
    const analysis = await analyzeGame(engine, game, {
      engineName: 'Stockfish 19 lite',
      depth: 16,
      checkDepth: 20,
    });
    return {
      game,
      analysis,
      summary: summarizeReview(
        analysis.positions,
        game.moves,
        game.firstMover,
        game.fens
      ),
    };
  } finally {
    close();
  }
}

const RETI =
  '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5 ' +
  '8. O-O-O Nxe4 9. Qd8+ Kxd8 10. Bg5+ Kc7 11. Bd8# 1-0';

const IMMORTAL =
  '1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 ' +
  'Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 ' +
  '15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 ' +
  'd4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ ' +
  'Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ ' +
  'Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 ' +
  'Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0';

// Smoke check, not a rule test: a side that is clearly lost after its move
// (< 30% for the mover) never gets !!.
function noLostBrilliancy(summary: ReviewSummary, analysis: ReviewAnalysis) {
  for (const p of summary.plies) {
    const after = analysis.positions[p.ply]?.score;
    if (!after || p.cls !== 'brilliant') continue;
    const white = winPercent(after);
    expect(p.side === 'white' ? white : 100 - white).toBeGreaterThanOrEqual(30);
  }
}

describe('Game Review with the real engine', () => {
  it(
    'Reti-Tartakower: 8...Nxe4 is a blunder, 9.Qd8+ is best',
    { timeout: 120_000 },
    async () => {
      const { summary, analysis } = await review(RETI);
      const nxe4 = summary.plies[15]; // ply 16
      const qd8 = summary.plies[16];
      expect(nxe4?.move).toBe('f6e4');
      expect(nxe4?.cls).toBe('blunder');
      // The deeper check replaces the shallow "Nxe4 is best" suggestion.
      expect(analysis.positions[15]?.best).not.toBe('f6e4');
      expect(qd8?.move).toBe('d3d8');
      expect(['best', 'excellent']).toContain(qd8?.cls);
      noLostBrilliancy(summary, analysis);
      expect(summary.counts.black.blunder).toBeGreaterThanOrEqual(1);
    }
  );

  it(
    'Kasparov-Topalov: 24.Rxd4 is not an error and White has no blunders',
    { timeout: 300_000 },
    async () => {
      const { summary, analysis } = await review(IMMORTAL);
      const rxd4 = summary.plies[46]; // ply 47 = 24.Rxd4
      expect(rxd4?.move).toBe('d1d4');
      expect(rxd4?.cls).not.toMatch(/inaccuracy|mistake|blunder/);
      noLostBrilliancy(summary, analysis);
      expect(summary.counts.white.blunder).toBe(0);
    }
  );
});
