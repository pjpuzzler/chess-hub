import { Chess } from 'chess.js';
import type { PollResult } from '../api';

export type ParsedPosition = {
  // Start position (the PGN's FEN header if present, otherwise the standard one).
  startFen: string;
  // Position after all moves; equals `startFen` for a bare FEN.
  fen: string;
  // The PGN as entered, only for PGN input.
  pgn: string | null;
  // Last move of the PGN in UCI, if any.
  lastMove: string | null;
  turn: 'white' | 'black';
};

const FEN_LIKE = /^[pnbrqkPNBRQK1-8/]+\s+[wb]\s+\S+\s+\S+(\s+\d+\s+\d+)?$/;

export const sideName = (turn: 'w' | 'b'): 'white' | 'black' =>
  turn === 'w' ? 'white' : 'black';

/**
 * Pull a FEN out of a lichess.org analysis/editor URL such as
 * https://lichess.org/analysis/<ranks>/<more ranks>_w_KQkq_-_0_1?color=white
 * (optionally with a variant segment). Purely local; nothing is fetched.
 */
export const fenFromLichessUrl = (text: string): string | null => {
  const m =
    /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/(?:analysis|editor)\/(.+)$/i.exec(
      text.trim()
    );
  if (!m?.[1]) return null;
  let rest = m[1].split(/[?#]/)[0] ?? '';
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  rest = rest.replace(/_/g, ' ').replace(/\/+$/, '');
  // The first segment may be a variant name ("standard"); try with and without.
  const withoutVariant = rest.slice(rest.indexOf('/') + 1);
  for (const cand of [rest, withoutVariant]) {
    if (FEN_LIKE.test(cand.replace(/\s+/g, ' ').trim())) return cand;
  }
  return null;
};

/** Parse user-supplied FEN, PGN or lichess analysis URL. Errors are user-facing. */
export const parsePosition = (
  input: string
): ParsedPosition | { error: string } => {
  const raw = input.trim();
  if (!raw)
    return { error: 'Enter a FEN, a PGN or a lichess.org analysis link.' };
  const text = fenFromLichessUrl(raw) ?? raw;
  const oneLine = text.replace(/\s+/g, ' ');

  if (FEN_LIKE.test(oneLine)) {
    try {
      const chess = new Chess(oneLine);
      const fen = chess.fen();
      return {
        startFen: fen,
        fen,
        pgn: null,
        lastMove: null,
        turn: sideName(chess.turn()),
      };
    } catch (e) {
      return { error: `That FEN isn't a legal position (${errorText(e)}).` };
    }
  }

  try {
    const chess = new Chess();
    chess.loadPgn(text);
    const history = chess.history({ verbose: true });
    const last = history[history.length - 1];
    const header = chess.getHeaders()['FEN'];
    return {
      startFen: header ? new Chess(header).fen() : new Chess().fen(),
      fen: chess.fen(),
      pgn: text,
      lastMove: last ? `${last.from}${last.to}${last.promotion ?? ''}` : null,
      turn: sideName(chess.turn()),
    };
  } catch {
    return {
      error: "That isn't a FEN, PGN or lichess.org analysis link we can read.",
    };
  }
};

const errorText = (e: unknown): string =>
  e instanceof Error
    ? (e.message.split('\n')[0] ?? '').replace(/^Invalid FEN:\s*/i, '')
    : 'unreadable';

/** True if the side to move has at least one legal move. */
export const hasLegalMoves = (fen: string): boolean => {
  try {
    return new Chess(fen).moves().length > 0;
  } catch {
    return false;
  }
};

/** Apply a UCI move; returns the resulting FEN, or null if illegal. */
export const playUci = (fen: string, uci: string): string | null => {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  try {
    const chess = new Chess(fen);
    chess.move({
      from: m[1] ?? '',
      to: m[2] ?? '',
      ...(m[3] ? { promotion: m[3] } : {}),
    });
    return chess.fen();
  } catch {
    return null;
  }
};

/**
 * Validate a UCI move against a position. Returns the canonical UCI and SAN, or
 * null if it is malformed or illegal.
 */
export const checkMove = (
  fen: string,
  uci: string
): { uci: string; san: string } | null => {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  try {
    const move = new Chess(fen).move({
      from: m[1] ?? '',
      to: m[2] ?? '',
      ...(m[3] ? { promotion: m[3] } : {}),
    });
    return {
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      san: move.san,
    };
  } catch {
    return null;
  }
};

/** Results sorted by votes (desc), then SAN for a stable order. */
export const tally = (
  fen: string,
  counts: Record<string, number>
): PollResult[] =>
  Object.entries(counts)
    .filter(([, votes]) => votes > 0)
    .flatMap(([move, votes]) => {
      const checked = checkMove(fen, move);
      return checked ? [{ move, san: checked.san, votes }] : [];
    })
    .sort((a, b) => b.votes - a.votes || a.san.localeCompare(b.san));
