// Inline splash: what to say (pure) and how to draw it (plain DOM).
// All user-provided text (prompts, captions, player names, usernames) goes
// through textContent only; nothing here builds HTML from strings.
import type { InitResponse, PostData, PostKind } from '../shared/api';
import { surname } from '../shared/chess/names';
import { communityReview, gameLabel, toPlay } from './lib/community';
import {
  piecesFromFen,
  sideToMove,
  squarePosition,
  type PieceColor,
} from './lib/fen-lite';
import {
  durationShort,
  plural,
  sharePercents,
  timeControlLabel,
} from './lib/format';

export type Info = {
  label: string; // "Daily Puzzle #42"
  title: string | null; // null = still loading
  meta: string;
  cta: string;
  done: boolean; // viewer already took part (quieter button)
  arrow: string | null; // UCI move to draw on the board
};

export const LABEL: Record<PostKind, string> = {
  puzzle: 'Daily Puzzle',
  poll: 'What’s the move?',
  review: 'Game Review',
  elo: 'Guess the Elo',
  game: 'Community game',
};
export const CTA: Record<PostKind, string> = {
  puzzle: 'Solve',
  poll: 'Vote',
  review: 'Review',
  elo: 'Guess',
  game: 'Vote',
};

export function loadingInfo(kind: PostKind): Info {
  return {
    label: LABEL[kind],
    title: null,
    meta: '',
    cta: CTA[kind],
    done: false,
    arrow: null,
  };
}

export type Accuracy = { white: number | null; black: number | null };

export function infoFromInit(
  init: InitResponse,
  now: number,
  accuracy: Accuracy | null = null
): Info {
  const post = init.post;
  if (post.kind === 'puzzle') {
    const solver = sideToMove(post.puzzle.fen) === 'white' ? 'Black' : 'White';
    const done = post.puzzle.solution !== null;
    const next =
      post.nextPuzzleAt !== null && post.nextPuzzleAt > now
        ? `Next in ${durationShort(post.nextPuzzleAt - now)}`
        : '';
    const solved = post.me?.status === 'solved';
    return {
      label: `${init.flags.anarchy ? 'Daily Anarchy Puzzle' : 'Daily Puzzle'} #${post.number}`,
      title: done
        ? solved
          ? 'Solved'
          : 'Solution shown'
        : `${solver} to play`,
      meta: done ? next : (post.tagline ?? `Rated ${post.puzzle.rating}`),
      cta: done ? 'Open' : 'Solve',
      done,
      arrow: null,
    };
  }
  if (post.kind === 'poll') {
    const closed = post.closesAt !== null && post.closesAt <= now;
    const top = post.results?.[0];
    if (post.results && top && (closed || post.myVote)) {
      const pct = sharePercents(post.results.map((r) => r.votes))[0] ?? 0;
      return {
        label: LABEL.poll,
        title: post.prompt,
        meta: `${top.san} ${closed ? 'won' : 'leads'} with ${pct}%`,
        cta: 'Results',
        done: true,
        arrow: top.move,
      };
    }
    const when = closed
      ? ' · closed'
      : post.closesAt !== null
        ? ` · closes in ${durationShort(post.closesAt - now)}`
        : '';
    return {
      label: LABEL.poll,
      title: post.prompt,
      meta: `${plural(post.totalVotes, 'vote')}${when}`,
      cta: 'Vote',
      done: false,
      arrow: null,
    };
  }
  if (post.kind === 'review') {
    const pct = (v: number | null) => (v === null ? '–' : v.toFixed(1));
    return {
      label: LABEL.review,
      title:
        communityReview(post)?.short ??
        `${surname(post.white)} vs ${surname(post.black)}`,
      meta: accuracy
        ? // No-break spaces keep the two figures together when the line wraps.
          `${post.result} · accuracy ${pct(accuracy.white)}\u00a0/\u00a0${pct(accuracy.black)}`
        : post.caption
          ? `${post.result} · ${post.caption}`
          : post.result,
      cta: 'Review',
      done: false,
      arrow: null,
    };
  }
  if (post.kind === 'game') {
    const label = gameLabel(post.gameNumber);
    const move = `Move ${post.moveNumber}`;
    const side = post.turn === 'white' ? 'White' : 'Black';
    if (post.status === 'ended')
      return {
        label,
        title: 'Game ended',
        meta: `${move} · ended by the mods`,
        cta: 'Open',
        done: true,
        arrow: null,
      };
    if (post.status === 'closed')
      return {
        label,
        title: post.winningMove
          ? `${side} played ${post.winningMove.san}`
          : 'Voting closed',
        meta: `${move} · ${plural(post.totalVotes, 'vote')}`,
        cta: 'Open',
        done: true,
        arrow: post.winningMove?.move ?? null,
      };
    const top = post.results?.[0];
    if (post.myVote && post.results && top) {
      const pct = sharePercents(post.results.map((r) => r.votes))[0] ?? 0;
      return {
        label,
        title: toPlay(post.turn),
        meta: `${move} · ${top.san} leads with ${pct}%`,
        cta: 'Results',
        done: true,
        arrow: top.move,
      };
    }
    return {
      label,
      title: toPlay(post.turn),
      meta: `${move} · ${plural(post.totalVotes, 'vote')}`,
      cta: 'Vote',
      done: false,
      arrow: null,
    };
  }
  const guessed = post.myGuess !== null && post.reveal !== null;
  return {
    label: `Guess the Elo #${post.number}`,
    title: guessed
      ? `It was ${post.reveal?.average ?? '?'}`
      : 'How strong are they?',
    meta: guessed
      ? `You said ${post.myGuess}`
      : timeControlLabel(post.game.timeControl),
    cta: guessed ? 'Result' : 'Guess',
    done: guessed,
    arrow: null,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

function arrowSvg(uci: string, orientation: PieceColor): SVGSVGElement | null {
  const m = /^([a-h])([1-8])([a-h])([1-8])/.exec(uci);
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const center = (f: string, r: string) => {
    const pos = squarePosition(
      f.charCodeAt(0) - 97,
      Number(r) - 1,
      orientation
    );
    return { x: pos.left / 12.5 + 0.5, y: pos.top / 12.5 + 0.5 };
  };
  const a = center(m[1], m[2]);
  const b = center(m[3], m[4]);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('class', 'arrow');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVG, 'defs');
  const marker = document.createElementNS(SVG, 'marker');
  marker.setAttribute('id', 'ah');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerWidth', '4');
  marker.setAttribute('markerHeight', '4');
  marker.setAttribute('refX', '2');
  marker.setAttribute('refY', '2');
  const head = document.createElementNS(SVG, 'path');
  head.setAttribute('d', 'M0,0 L4,2 L0,4 z');
  marker.append(head);
  defs.append(marker);
  // Stop short of the centre so the head lands on the square.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const line = document.createElementNS(SVG, 'line');
  line.setAttribute('x1', String(a.x));
  line.setAttribute('y1', String(a.y));
  line.setAttribute('x2', String(b.x - (dx / len) * 0.35));
  line.setAttribute('y2', String(b.y - (dy / len) * 0.35));
  line.setAttribute('marker-end', 'url(#ah)');
  svg.append(defs, line);
  return svg;
}

export function renderBoard(
  fen: string | null,
  orientation: PieceColor,
  arrow: string | null,
  onOpen: (e: MouseEvent) => void
): HTMLElement {
  const board = el('button', 'board mini-board cg-wrap');
  board.type = 'button';
  board.setAttribute('aria-label', 'Open');
  board.addEventListener('click', onOpen);
  if (!fen) {
    board.classList.add('skeleton');
    return board;
  }
  for (const p of piecesFromFen(fen)) {
    const piece = document.createElement('piece');
    piece.className = `${p.role} ${p.color}`;
    const pos = squarePosition(p.file, p.rank, orientation);
    piece.style.left = `${pos.left}%`;
    piece.style.top = `${pos.top}%`;
    board.append(piece);
  }
  const svg = arrow ? arrowSvg(arrow, orientation) : null;
  if (svg) board.append(svg);
  return board;
}

export function renderInfo(
  info: Info,
  error: string | null,
  onOpen: (e: MouseEvent) => void
): HTMLElement {
  const box = el('div', 'info');
  // Nothing but placeholders until the data is in, so no text swaps.
  if (info.title === null && !error) {
    box.append(el('span', 'skeleton line wide'), el('span', 'skeleton line'));
    return box;
  }
  box.append(el('p', 'eyebrow', info.label));
  if (info.title !== null) {
    box.append(el('h1', 'title', info.title));
    if (info.meta) box.append(el('p', 'meta', info.meta));
  }
  if (error) box.append(el('p', 'meta', error));
  const cta = el('button', `cta ${info.done ? 'done' : ''}`, info.cta);
  cta.type = 'button';
  cta.addEventListener('click', onOpen);
  box.append(cta);
  return box;
}

export function renderSplash(
  root: HTMLElement,
  postData: PostData | null,
  info: Info,
  onOpen: (e: MouseEvent) => void,
  error: string | null = null
): void {
  root.replaceChildren(
    renderBoard(
      postData?.fen ?? null,
      postData?.orientation ?? 'white',
      info.arrow,
      onOpen
    ),
    renderInfo(info, error, onOpen)
  );
}
