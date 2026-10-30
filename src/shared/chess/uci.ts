// UCI `info` parsing (pure, shared by the browser engine and Node tests).
// Scores are normalised to White's point of view.
export type Score =
  { cp: number; mate?: undefined } | { mate: number; cp?: undefined };

export type PvLine = {
  multipv: number; // 1-based
  depth: number;
  score: Score; // White's point of view
  pv: string[]; // UCI moves
};

// Parses a UCI `info ... pv ...` line. Bound-only scores are skipped.
export function parseInfo(line: string, whiteToMove: boolean): PvLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const tokens = line.split(' ');
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'score') {
      const type = tokens[++i];
      const value = Number(tokens[++i]);
      const next = tokens[i + 1];
      if (next === 'lowerbound' || next === 'upperbound') return null;
      const sign = whiteToMove ? 1 : -1;
      if (type === 'cp') score = { cp: value * sign };
      else if (type === 'mate') score = { mate: value * sign };
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!score || pv.length === 0 || !Number.isFinite(depth)) return null;
  return { multipv, depth, score, pv };
}
