import { describe, expect, it } from 'vitest';
import { analyzeGame, type UciEngine } from './review-engine';
import { parseGame } from './review';

// A scripted engine: every search returns the score `scoreFor` picks.
function fakeEngine(scoreFor: (fen: string) => number): UciEngine {
  const out: string[] = [];
  let fen = '';
  return {
    send: (cmd) => {
      if (cmd === 'uci') out.push('uciok');
      else if (cmd === 'isready') out.push('readyok');
      else if (cmd.startsWith('position fen ')) fen = cmd.slice(13);
      else if (cmd.startsWith('go depth ')) {
        const cp = scoreFor(fen);
        out.push(`info depth 1 multipv 1 score cp ${cp} pv a2a3`);
        out.push('bestmove a2a3');
      }
    },
    next: () => Promise.resolve(out.shift() ?? ''),
  };
}

describe('review progress', () => {
  it('is one combined figure that never goes backwards', async () => {
    const game = parseGame(
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 ' +
        '7. Qf3+ Ke6 8. Nc3 Nb4 9. a3 Nxc2+ 10. Kd1 Nxa1 11. Nxd5 Kd6 *'
    );
    if ('error' in game) throw new Error(game.error);
    // Swinging scores make many moves look like errors, so the re-check pass
    // is long and only discovered as the scan goes.
    let k = 0;
    const engine = fakeEngine(() => (k++ % 4 < 2 ? 400 : -400));
    const seen: number[] = [];
    await analyzeGame(engine, game, {
      engineName: 'fake',
      depth: 16,
      checkDepth: 20,
      onProgress: (p) => seen.push(p.fraction),
    });
    expect(seen.length).toBeGreaterThan(game.fens.length);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] ?? 0);
    expect(seen.at(-1)).toBe(1);
    // The scan alone doesn't claim the whole bar.
    expect(seen[game.fens.length - 1]).toBeLessThan(0.9);
  });
});
