// Builds src/server/data/puzzles.json (classic easy/medium/hard) and
// src/server/data/anarchy-puzzles.json (themed weekday buckets for the
// Anarchy style) from the Lichess puzzle database (CC0).
// Run: node --experimental-strip-types tools/build-puzzles.ts [path/to/lichess_db_puzzle.csv.zst]
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Chess, type Move, type Square } from 'chess.js';

const URL_ = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const CACHE = join(tmpdir(), 'chess-hub-puzzles', 'lichess_db_puzzle.csv.zst');
const OUT = resolve(import.meta.dirname, '../src/server/data/puzzles.json');
const ANARCHY_OUT = resolve(
  import.meta.dirname,
  '../src/server/data/anarchy-puzzles.json'
);
const PER_BUCKET = 900;
const SEED = 20261029;
// At most this share of a bucket may carry the generic `mate` theme.
const MAX_MATE_SHARE = 0.3;

const MIN_POPULARITY = 85;
const MIN_PLAYS = 2000;
const MAX_RD = 80;
const MIN_PLIES = 4;
const MAX_PLIES = 10;

const BUCKETS = [
  ['easy', 800, 1299],
  ['medium', 1300, 1799],
  ['hard', 1800, 2400],
] as const;

type Row = [string, string, string, number, string];
type Cand = { row: Row; themes: string[] };

// Small deterministic PRNG (mulberry32).
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = <T>(a: T[], r: () => number): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

// Tactical / structural themes worth balancing on. Generic tags (short, long,
// advantage, crushing, middlegame...) are ignored for grouping.
const GROUP_THEMES = new Set([
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'doubleCheck',
  'sacrifice',
  'deflection',
  'attraction',
  'clearance',
  'interference',
  'xRayAttack',
  'zugzwang',
  'trappedPiece',
  'hangingPiece',
  'capturingDefender',
  'quietMove',
  'intermezzo',
  'defensiveMove',
  'exposedKing',
  'kingsideAttack',
  'queensideAttack',
  'attackingF2F7',
  'promotion',
  'underPromotion',
  'enPassant',
  'castling',
  'advancedPawn',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'backRankMate',
  'smotheredMate',
  'anastasiaMate',
  'arabianMate',
  'bodenMate',
  'dovetailMate',
  'hookMate',
  'doubleBishopMate',
  'balestraMate',
  'blackburneMate',
  'cornerMate',
  'killBoxMate',
  'vukovicMate',
  'morphysMate',
  'operaMate',
  'pillsburysMate',
  'triangleMate',
  'swallowstailMate',
  'pawnEndgame',
  'rookEndgame',
  'bishopEndgame',
  'knightEndgame',
  'queenEndgame',
  'queenRookEndgame',
  'opening',
]);

// Anarchy buckets: one real Lichess theme per weekday.
const ANARCHY_PER_BUCKET = 150;
const ANARCHY_SEED = 20261030;
const ANARCHY_MIN_POPULARITY = 85;
const ANARCHY_MIN_PLAYS = 500;
const ANARCHY_MAX_RD = 80;

type Replay = { game: Chess; moves: Move[]; doubleCheck: boolean[] };

// Replays a puzzle, recording for each ply whether it gave double check.
function replay(fen: string, ucis: string[]): Replay | null {
  try {
    const game = new Chess(fen);
    const moves: Move[] = [];
    const doubleCheck: boolean[] = [];
    for (const m of ucis) {
      moves.push(
        game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })
      );
      doubleCheck.push(checkers(game) >= 2);
    }
    return { game, moves, doubleCheck };
  } catch {
    return null;
  }
}

function kingSquare(game: Chess, color: 'w' | 'b'): Square | null {
  for (const row of game.board())
    for (const p of row)
      if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

// Number of enemy pieces giving check to the side to move.
function checkers(game: Chess): number {
  const us = game.turn();
  const k = kingSquare(game, us);
  return k ? game.attackers(k, us === 'w' ? 'b' : 'w').length : 0;
}

// Strict smothered mate: knight mates and every square next to the king is
// on the board edge or held by the king's own pieces.
function isSmothered(r: Replay): boolean {
  const { game, moves } = r;
  if (!game.isCheckmate() || moves.at(-1)!.piece !== 'n') return false;
  const k = kingSquare(game, game.turn())!;
  const f = k.charCodeAt(0);
  const rank = +k[1]!;
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const nf = f + df;
      const nr = rank + dr;
      if (nf < 97 || nf > 104 || nr < 1 || nr > 8) continue;
      const p = game.get(`${String.fromCharCode(nf)}${nr}` as Square);
      if (!p || p.color !== game.turn()) return false;
    }
  return true;
}

// Solver plies are the odd indices (index 0 is the opponent's setup move).
const solverPlies = <T>(a: T[]) => a.filter((_, i) => i % 2 === 1);

type AnarchySpec = {
  name: string;
  tag: string | null; // required Lichess theme, null = any
  minRating: number;
  maxRating: number;
  preferMaxRating: number; // ratings at or below this are picked first
  plies: [number, number];
  check: (r: Replay) => boolean; // the bucket's defining property
};

const ANARCHY: AnarchySpec[] = [
  {
    name: 'enPassant',
    tag: 'enPassant',
    minRating: 0,
    maxRating: 3500,
    preferMaxRating: 1700,
    plies: [2, 10],
    check: (r) => r.moves[1]!.isEnPassant(),
  },
  {
    name: 'knightBoost',
    tag: 'underPromotion',
    minRating: 0,
    maxRating: 3500,
    preferMaxRating: 3500,
    plies: [2, 10],
    check: (r) => solverPlies(r.moves).some((m) => m.promotion === 'n'),
  },
  {
    name: 'doubleCheck',
    tag: 'doubleCheck',
    minRating: 0,
    maxRating: 3500,
    preferMaxRating: 1700,
    plies: [2, 10],
    check: (r) => solverPlies(r.doubleCheck).some(Boolean),
  },
  {
    name: 'castling',
    tag: 'castling',
    minRating: 0,
    maxRating: 3500,
    preferMaxRating: 3500,
    plies: [2, 10],
    check: (r) =>
      solverPlies(r.moves).some(
        (m) => m.isKingsideCastle() || m.isQueensideCastle()
      ),
  },
  {
    name: 'smothered',
    tag: 'smotheredMate',
    minRating: 0,
    maxRating: 3500,
    preferMaxRating: 3500,
    plies: [2, 10],
    check: isSmothered,
  },
  {
    name: 'easyMate',
    tag: 'mateIn1',
    minRating: 0,
    maxRating: 999,
    preferMaxRating: 999,
    plies: [2, 2],
    check: (r) => r.game.isCheckmate(),
  },
  {
    name: 'hard',
    tag: null,
    minRating: 1900,
    maxRating: 2300,
    preferMaxRating: 2300,
    plies: [MIN_PLIES, MAX_PLIES],
    check: () => true,
  },
];

async function ensureArchive(arg?: string): Promise<string> {
  if (arg) return arg;
  if (!existsSync(CACHE)) {
    mkdirSync(dirname(CACHE), { recursive: true });
    console.log(`downloading ${URL_}`);
    execFileSync('curl', ['-sSfL', '-o', CACHE, URL_], { stdio: 'inherit' });
  }
  return CACHE;
}

function validate(fen: string, moves: string[]): boolean {
  try {
    const g = new Chess(fen);
    for (const m of moves) {
      const r = g.move({
        from: m.slice(0, 2),
        to: m.slice(2, 4),
        promotion: m[4],
      });
      if (!r) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const archive = await ensureArchive(process.argv[2]);
  const zstd = spawn(
    existsSync('/opt/homebrew/bin/zstd') ? '/opt/homebrew/bin/zstd' : 'zstd',
    ['-dc', archive],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const lines = createInterface({ input: zstd.stdout });
  let col: Record<string, number> | null = null;
  const pools: Record<string, Cand[]> = { easy: [], medium: [], hard: [] };
  const anarchyPools: Record<string, Cand[]> = Object.fromEntries(
    ANARCHY.map((a) => [a.name, []])
  );
  let total = 0;
  for await (const line of lines) {
    const f = line.split(',');
    if (!col) {
      col = Object.fromEntries(f.map((n, i) => [n, i]));
      continue;
    }
    total++;
    const header = col;
    const g = (n: string) => f[header[n]!]!;
    const popularity = +g('Popularity');
    const plays = +g('NbPlays');
    const rd = +g('RatingDeviation');
    const rating = +g('Rating');
    const moves = g('Moves');
    const plies = moves.split(' ').length;
    const themes = g('Themes').split(' ').filter(Boolean);
    const cand = (): Cand => ({
      row: [g('PuzzleId'), g('FEN'), moves, rating, themes.join(' ')],
      themes,
    });
    if (
      popularity >= ANARCHY_MIN_POPULARITY &&
      plays >= ANARCHY_MIN_PLAYS &&
      rd <= ANARCHY_MAX_RD
    ) {
      for (const a of ANARCHY)
        if (
          (a.tag === null || themes.includes(a.tag)) &&
          rating >= a.minRating &&
          rating <= a.maxRating &&
          plies >= a.plies[0] &&
          plies <= a.plies[1]
        )
          anarchyPools[a.name]!.push(cand());
    }
    if (popularity < MIN_POPULARITY) continue;
    if (plays < MIN_PLAYS) continue;
    if (rd > MAX_RD) continue;
    const b = BUCKETS.find(([, lo, hi]) => rating >= lo && rating <= hi);
    if (!b) continue;
    if (plies < MIN_PLIES || plies > MAX_PLIES) continue;
    pools[b[0]]!.push(cand());
  }
  console.log(`rows scanned: ${total}`);

  const rand = rng(SEED);
  const out: Record<string, Row[]> = {};
  const report: string[] = [];
  let invalid = 0;
  for (const [name] of BUCKETS) {
    const pool = pools[name]!;
    // Candidate theme frequencies; assign each puzzle to its rarest group theme.
    const freq = new Map<string, number>();
    for (const c of pool)
      for (const t of c.themes)
        if (GROUP_THEMES.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
    const groups = new Map<string, Cand[]>();
    for (const c of pool) {
      const ts = c.themes.filter((t) => GROUP_THEMES.has(t));
      const key = ts.length
        ? ts.reduce((a, b) => (freq.get(b)! < freq.get(a)! ? b : a))
        : 'other';
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
    }
    const keys = [...groups.keys()].sort();
    for (const k of keys) shuffle(groups.get(k)!, rand);
    // Round-robin across groups so no theme dominates; validate as we pick.
    const picked: Row[] = [];
    const mateCap = Math.floor(PER_BUCKET * MAX_MATE_SHARE);
    let mates = 0;
    let progressed = true;
    while (picked.length < PER_BUCKET && progressed) {
      progressed = false;
      for (const k of shuffle([...keys], rand)) {
        const grp = groups.get(k)!;
        while (grp.length) {
          const c = grp.pop()!;
          const isMate = c.themes.includes('mate');
          if (isMate && mates >= mateCap) continue;
          if (validate(c.row[1], c.row[2].split(' '))) {
            picked.push(c.row);
            if (isMate) mates++;
            progressed = true;
            break;
          }
          invalid++;
        }
        if (picked.length >= PER_BUCKET) break;
      }
    }
    out[name] = shuffle(picked, rand);
    report.push(
      `${name}: pool ${pool.length}, picked ${picked.length}, groups ${keys.length}`
    );
  }
  console.log(report.join('\n'));
  console.log(`invalid dropped: ${invalid}`);

  const date = new Date().toISOString().slice(0, 10);
  const json = {
    version: 1,
    source: `Lichess puzzle database (CC0), ${date}`,
    easy: out.easy,
    medium: out.medium,
    hard: out.hard,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(json) + '\n');
  console.log(`wrote ${OUT} (${statSync(OUT).size} bytes)`);

  // Anarchy buckets: own RNG so the classic output above is unaffected.
  const arand = rng(ANARCHY_SEED);
  // Excluded ids: the classic hard bucket, then anything an earlier anarchy
  // bucket took, so no puzzle appears twice.
  const used = new Set(out.hard!.map((r) => r[0]));
  const anarchy: Record<string, Row[]> = {};
  for (const a of ANARCHY) {
    const pool = anarchyPools[a.name]!.filter((c) => !used.has(c.row[0]));
    const preferred = shuffle(
      pool.filter((c) => c.row[3] <= a.preferMaxRating),
      arand
    );
    const rest = shuffle(
      pool.filter((c) => c.row[3] > a.preferMaxRating),
      arand
    );
    // Same 30% mate cap as classic for the any-theme bucket.
    const mateCap =
      a.tag === null
        ? Math.floor(ANARCHY_PER_BUCKET * MAX_MATE_SHARE)
        : Infinity;
    let mates = 0;
    let failed = 0;
    const picked: Row[] = [];
    for (const c of [...preferred, ...rest]) {
      if (picked.length >= ANARCHY_PER_BUCKET) break;
      const isMate = c.themes.includes('mate');
      if (isMate && mates >= mateCap) continue;
      const r = replay(c.row[1], c.row[2].split(' '));
      if (!r || !a.check(r)) {
        failed++;
        continue;
      }
      picked.push(c.row);
      used.add(c.row[0]);
      if (isMate) mates++;
    }
    anarchy[a.name] = shuffle(picked, arand);
    console.log(
      `anarchy ${a.name}: pool ${pool.length}, preferred ${preferred.length}, picked ${picked.length}, failed check ${failed}`
    );
  }
  writeFileSync(
    ANARCHY_OUT,
    JSON.stringify({ version: 1, source: json.source, buckets: anarchy }) + '\n'
  );
  console.log(`wrote ${ANARCHY_OUT} (${statSync(ANARCHY_OUT).size} bytes)`);
}

await main();
