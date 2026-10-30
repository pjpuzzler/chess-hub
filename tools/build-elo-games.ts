// Builds src/server/data/elo-games.json for "Guess the Elo" from the Lichess open database (CC0).
// Streams the monthly PGN with curl | zstd and stops once every Elo bucket has enough candidates.
// Run: node --experimental-strip-types tools/build-elo-games.ts [pgn-url-or-path]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chess.js';

const FILE = 'lichess_db_standard_rated_2025-06.pgn.zst';
const URL_ = `https://database.lichess.org/standard/${FILE}`;
const OUT = resolve(import.meta.dirname, '../src/server/data/elo-games.json');
const SEED = 20261029;
const PER_BUCKET = 70;
const MAX_SCAN = 40_000_000; // safety cap on games read
const MAX_ELO_DIFF = 150;
const MIN_MOVES = 20;
const MAX_MOVES = 70;
const MIN_BASE = 180;

const BUCKET_LO = 600;
const BUCKET_W = 200;
const N_BUCKETS = 11; // 600-799 ... 2600-2799

type Cls = 'blitz' | 'rapid' | 'classical';
const CLASSES: Cls[] = ['blitz', 'rapid', 'classical'];
// Candidate caps per class and selection quota per bucket (sums to PER_BUCKET).
const CAND_CAP: Record<Cls, number> = { blitz: 90, rapid: 90, classical: 50 };
const QUOTA: Record<Cls, number> = { blitz: 28, rapid: 28, classical: 14 };

type Game = {
  moves: string;
  tc: string;
  result: string;
  w: number;
  b: number;
  cls: Cls;
};

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

// Clean movetext into SAN tokens: no comments, NAGs, annotations, move numbers or result.
function sanTokens(raw: string): string[] {
  return raw
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\$\d+/g, ' ')
    .split(/\s+/)
    .filter(
      (t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)
    )
    .map((t) => t.replace(/^\d+\.+/, '').replace(/[?!]+$/, ''))
    .filter(Boolean);
}
const format = (san: string[]): string => {
  const out: string[] = [];
  san.forEach((m, i) => out.push(i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m));
  return out.join(' ');
};

function classify(event: string, tc: string): Cls | null {
  const m = /^(\d+)\+(\d+)$/.exec(tc);
  if (!m) return null;
  if (Number(m[1]) < MIN_BASE) return null;
  if (!/^Rated (Blitz|Rapid|Classical) game$/.test(event)) return null;
  return event.includes('Blitz')
    ? 'blitz'
    : event.includes('Rapid')
      ? 'rapid'
      : 'classical';
}

const stats = { scanned: 0, filtered: 0, invalid: 0, dupPlayer: 0 };
const cand: Record<Cls, Game[]>[] = Array.from({ length: N_BUCKETS }, () => ({
  blitz: [],
  rapid: [],
  classical: [],
}));
const seenPlayers = new Set<string>();

function handle(tags: Map<string, string>, movetext: string): void {
  stats.scanned++;
  const we = Number(tags.get('WhiteElo'));
  const be = Number(tags.get('BlackElo'));
  if (!Number.isInteger(we) || !Number.isInteger(be) || we <= 0 || be <= 0)
    return;
  if (!tags.has('WhiteRatingDiff') || !tags.has('BlackRatingDiff')) return;
  if (
    tags.get('WhiteElo')!.includes('?') ||
    tags.get('BlackElo')!.includes('?')
  )
    return;
  if (Math.abs(we - be) > MAX_ELO_DIFF) return;
  const avg = Math.round((we + be) / 2);
  const bi = Math.floor((avg - BUCKET_LO) / BUCKET_W);
  if (bi < 0 || bi >= N_BUCKETS) return;
  const term = tags.get('Termination');
  if (term !== 'Normal' && term !== 'Time forfeit') return;
  const tc = tags.get('TimeControl') ?? '';
  const cls = classify(tags.get('Event') ?? '', tc);
  if (!cls) return;
  const result = tags.get('Result') ?? '';
  if (!['1-0', '0-1', '1/2-1/2'].includes(result)) return;
  const bucket = cand[bi]![cls];
  if (bucket.length >= CAND_CAP[cls]) return;
  const san = sanTokens(movetext);
  const full = Math.ceil(san.length / 2);
  if (full < MIN_MOVES || full > MAX_MOVES) return;
  // One game per player pair member, so no single player dominates the set.
  const wn = tags.get('White') ?? '';
  const bn = tags.get('Black') ?? '';
  if (seenPlayers.has(wn) || seenPlayers.has(bn)) {
    stats.dupPlayer++;
    return;
  }
  stats.filtered++;
  const text = format(san);
  if (!valid(text, result)) {
    stats.invalid++;
    return;
  }
  seenPlayers.add(wn);
  seenPlayers.add(bn);
  bucket.push({ moves: text, tc, result, w: we, b: be, cls });
}

function valid(text: string, result: string): boolean {
  try {
    const g = new Chess();
    g.loadPgn(text);
    if (g.isCheckmate()) {
      // The side that just moved won; the side to move is mated.
      return result === (g.turn() === 'b' ? '1-0' : '0-1');
    }
    if (result !== '1/2-1/2' && g.isGameOver() && !g.isCheckmate())
      return false;
    return true;
  } catch {
    return false;
  }
}

// Enough candidates in every bucket to choose from (classical is scarce at low Elo, so no per-class wait).
const full = () =>
  cand.every((c) => CLASSES.reduce((s, k) => s + c[k].length, 0) >= 110);

async function main() {
  const src = process.argv[2] ?? URL_;
  const curl = spawn('curl', ['-sSfL', src], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const zstd = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
  curl.stdout.pipe(zstd.stdin);
  zstd.stdin.on('error', () => {});
  const rl = createInterface({ input: zstd.stdout });
  let tags = new Map<string, string>();
  let done = false;
  for await (const line of rl) {
    if (line.startsWith('[')) {
      const m = /^\[(\w+) "(.*)"\]$/.exec(line);
      if (m) tags.set(m[1]!, m[2]!);
    } else if (line.length > 0) {
      handle(tags, line);
      tags = new Map();
      if (stats.scanned % 1_000_000 === 0) {
        const n = cand.map((c) => CLASSES.reduce((s, k) => s + c[k].length, 0));
        console.error(`scanned ${stats.scanned}: ${n.join(' ')}`);
      }
      if (full() || stats.scanned >= MAX_SCAN) {
        done = true;
        break;
      }
    }
  }
  if (done) {
    curl.kill();
    zstd.kill();
  }

  // Select per bucket: class quotas first, then fill from whatever is left.
  const r = rng(SEED);
  const picked: Game[][] = cand.map((c) => {
    const pools = Object.fromEntries(
      CLASSES.map((k) => [k, shuffle([...c[k]], r)])
    ) as Record<Cls, Game[]>;
    const sel: Game[] = [];
    for (const k of CLASSES) sel.push(...pools[k].splice(0, QUOTA[k]));
    const rest = shuffle(
      CLASSES.flatMap((k) => pools[k]),
      r
    );
    sel.push(...rest.slice(0, PER_BUCKET - sel.length));
    return sel;
  });
  // Deterministic interleave: shuffle all selected games across buckets.
  const all = shuffle(picked.flat(), r);
  const games = all.map((g) => [g.moves, g.tc, g.result, g.w, g.b]);
  const json = {
    version: 1,
    source: `Lichess open database ${FILE} (CC0), https://database.lichess.org/`,
    games,
  };
  writeFileSync(OUT, JSON.stringify(json) + '\n');

  console.log(
    `scanned ${stats.scanned} games, ${stats.filtered} passed filters, ${stats.invalid} failed chess.js, ${stats.dupPlayer} skipped (repeat player)`
  );
  picked.forEach((p, i) => {
    const lo = BUCKET_LO + i * BUCKET_W;
    const c = Object.fromEntries(
      CLASSES.map((k) => [k, p.filter((g) => g.cls === k).length])
    );
    console.log(`${lo}-${lo + BUCKET_W - 1}: ${p.length} ${JSON.stringify(c)}`);
  });
  console.log(`total ${games.length}, ${statSync(OUT).size} bytes -> ${OUT}`);
}

await main();
