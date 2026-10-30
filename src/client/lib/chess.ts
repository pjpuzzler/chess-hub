// chess.js helpers for the expanded view (never imported by the splash).
import { Chess, type Move } from 'chess.js';
import type { Color, Dests, Key } from 'chessground/types';
import { allKeys } from 'chessground/util';
import { parseUci } from '../../shared/chess/puzzle';

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type LineMove = {
  uci: string;
  san: string;
  fen: string; // position after the move
  enPassant: boolean;
};

export function toKey(square: string): Key | undefined {
  return allKeys.find((k) => k === square);
}

export function uciKeys(
  uci: string | null | undefined
): [Key, Key] | undefined {
  if (!uci) return undefined;
  const from = toKey(uci.slice(0, 2));
  const to = toKey(uci.slice(2, 4));
  return from && to ? [from, to] : undefined;
}

export function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

export function destsOf(fen: string): Dests {
  const dests: Dests = new Map();
  const chess = new Chess(fen);
  for (const m of chess.moves({ verbose: true })) {
    const from = toKey(m.from);
    const to = toKey(m.to);
    if (!from || !to) continue;
    const list = dests.get(from);
    if (list) {
      if (!list.includes(to)) list.push(to);
    } else dests.set(from, [to]);
  }
  return dests;
}

function lineMove(m: Move): LineMove {
  return { uci: m.lan, san: m.san, fen: m.after, enPassant: m.isEnPassant() };
}

// Plays `uci` from `fen`; null if illegal.
export function playMove(fen: string, uci: string): LineMove | null {
  const move = parseUci(uci);
  if (!move) return null;
  try {
    return lineMove(new Chess(fen).move(move));
  } catch {
    return null;
  }
}

export function buildLine(
  startFen: string,
  ucis: readonly string[]
): LineMove[] {
  const line: LineMove[] = [];
  let fen = startFen;
  for (const uci of ucis) {
    const m = playMove(fen, uci);
    if (!m) break;
    line.push(m);
    fen = m.fen;
  }
  return line;
}

export function parsePgn(
  pgn: string
): { startFen: string; moves: LineMove[] } | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const history = chess.history({ verbose: true });
  const startFen = history[0]?.before ?? chess.fen();
  return { startFen, moves: history.map(lineMove) };
}

export function isEnPassantAvailable(fen: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some((m) => m.isEnPassant());
}

export type GameEnd = 'checkmate' | 'stalemate' | 'draw' | null;
export function gameEnd(fen: string): GameEnd {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isInsufficientMaterial()) return 'draw';
  return null;
}

export function inCheck(fen: string): boolean {
  return new Chess(fen).inCheck();
}

// SAN for a principal variation, numbered from `fen` ("12. Nf3 Nc6 13. e4" or "12... Nc6").
export function pvToSan(fen: string, pv: readonly string[], max = 10): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  let moveNo = Number(fen.split(' ')[5] ?? 1);
  let white = turnOf(fen) === 'white';
  for (const [i, uci] of pv.slice(0, max).entries()) {
    const move = parseUci(uci);
    if (!move) break;
    let san: string;
    try {
      san = chess.move(move).san;
    } catch {
      break;
    }
    if (white) parts.push(`${moveNo}. ${san}`);
    else parts.push(i === 0 ? `${moveNo}... ${san}` : san);
    if (!white) moveNo += 1;
    white = !white;
  }
  return parts.join(' ');
}

// Move number label for the move that leads to `line[index]` (0-based ply from start).
export function plyLabel(
  startFen: string,
  index: number
): { no: number; white: boolean } {
  const startNo = Number(startFen.split(' ')[5] ?? 1);
  const startWhite = turnOf(startFen) === 'white';
  const ply = index + (startWhite ? 0 : 1);
  return { no: startNo + Math.floor(ply / 2), white: ply % 2 === 0 };
}

// Typed move text (SAN like "Nf3"/"exd6"/"e8=Q", or UCI like "g1f3") to UCI.
export function parseMoveText(fen: string, text: string): string | null {
  const t = text.trim().replace(/[!?]+$/, '');
  if (!t) return null;
  const uci = t.toLowerCase();
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))
    return playMove(fen, uci)?.uci ?? null;
  try {
    return new Chess(fen).move(t).lan;
  } catch {
    return null;
  }
}
