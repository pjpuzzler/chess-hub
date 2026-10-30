import type { DrawShape } from 'chessground/draw';
import type { PollResult } from '../../shared/api';
import { uciKeys } from './chess';

// Arrows for the top voted moves, thicker for a bigger share.
export function voteShapes(results: PollResult[], pcts: number[]): DrawShape[] {
  return results.slice(0, 4).flatMap((r, i) => {
    const keys = uciKeys(r.move);
    if (!keys) return [];
    const share = (pcts[i] ?? 0) / 100;
    return [
      {
        orig: keys[0],
        dest: keys[1],
        brush: i === 0 ? 'green' : 'paleGrey',
        modifiers: { lineWidth: Math.round(4 + share * 14) },
      },
    ];
  });
}
