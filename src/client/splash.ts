// Inline (feed) view. Kept dependency-light on purpose: no React, chess.js,
// Chessground or engine here, so it paints well under a second.
import 'chessground/assets/chessground.cburnett.css';
import './styles/theme.css';
import './styles/splash.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import type { InitResponse, PostData } from '../shared/api';
import { api } from './lib/api';
import { sideToMove } from './lib/fen-lite';
import { boardSide, snapToPixels } from './lib/pixel';
import {
  infoFromInit,
  infoFromPostData,
  readPostData,
  renderSplash,
} from './splash-view';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// Side to move first: from the PGN's FEN header, White otherwise. (Regex
// only, so the splash bundle stays free of chess.js.)
function firstMoverOf(pgn: string): 'white' | 'black' {
  return /\[FEN "[^"]*\s(b)\s/.exec(pgn) ? 'black' : 'white';
}

function openGame(event: MouseEvent): void {
  try {
    requestExpandedMode(event, 'game');
  } catch (err) {
    console.error('requestExpandedMode failed', err);
  }
}

// Layout: whichever of "board on top, one text row below" and "board left,
// text right" gives the bigger board; the board side is whole pixels per
// square with its corner on a whole pixel, so all squares are equal and no
// sliver of the board background shows at an edge.
const PAD = 12; // .card padding
const GAP = 12; // .card gap
const TEXT_ROW = 76; // col: the text row under the board
const TEXT_COL = 96; // row: the narrowest text column that reads well
const MAX_BOARD = 440;
const MIN_BOARD = 64; // smaller than this means the card had no size yet
const MAX_RETRIES = 600; // ~10 s of frames, then rely on resize events
let retries = 0;

function fitBoard(): void {
  const board = root?.querySelector<HTMLElement>('.board');
  if (!root || !board) return;
  const w = root.clientWidth;
  const h = root.clientHeight;
  const col = Math.min(w - 2 * PAD, h - 2 * PAD - TEXT_ROW - GAP, MAX_BOARD);
  const row = Math.min(h - 2 * PAD, w - 2 * PAD - GAP - TEXT_COL, MAX_BOARD);
  const useCol = col >= row;
  root.classList.toggle('col', useCol);
  root.classList.toggle('row', !useCol);
  const fit = boardSide(Math.max(0, useCol ? col : row));
  board.style.width = `${fit}px`;
  board.style.height = `${fit}px`;
  snapToPixels(board);
  // The card isn't laid out yet (seen on desktop Reddit, where no resize
  // event followed): try again next frame until the board has a real size.
  if (fit < MIN_BOARD && retries++ < MAX_RETRIES)
    requestAnimationFrame(fitBoard);
}

function render(...args: Parameters<typeof renderSplash>): void {
  renderSplash(...args);
  fitBoard();
}
// Also refit when the stylesheets land: the script can run before they
// apply, when the root has no height yet.
new ResizeObserver(fitBoard).observe(root);
window.addEventListener('load', fitBoard);

const initial = readPostData(context.postData);
// The post's fixed text shows at once; init then fills in the live parts.
const early = infoFromPostData(initial);
render(root, initial, early, openGame);

function fallbackPostData(init: InitResponse): PostData {
  const post = init.post;
  const fen =
    post.kind === 'puzzle'
      ? post.puzzle.fen
      : post.kind === 'poll' || post.kind === 'game'
        ? post.fen
        : START_FEN;
  return {
    kind: post.kind,
    fen,
    orientation:
      post.kind === 'game'
        ? post.turn
        : post.kind === 'puzzle' && sideToMove(fen) === 'white'
          ? 'black'
          : 'white',
  };
}

api
  .cardInit()
  .then((init) => {
    const post = init.post;
    const postData = initial ?? fallbackPostData(init);
    render(root, postData, infoFromInit(init, Date.now()), openGame);
    root.removeAttribute('aria-busy');
    if (post.kind === 'review' && post.analysis) {
      // Accuracy needs the review module (and chess.js), so it loads after
      // first paint instead of weighing down the splash bundle.
      const { positions } = post.analysis;
      import('../shared/chess/review')
        .then(({ gameAccuracy }) =>
          render(
            root,
            postData,
            infoFromInit(
              init,
              Date.now(),
              gameAccuracy(positions, firstMoverOf(post.pgn))
            ),
            openGame
          )
        )
        .catch((err: unknown) => console.error('accuracy failed', err));
    }
  })
  .catch((err: unknown) => {
    console.error('init failed', err);
    render(
      root,
      initial,
      { ...early, meta: early.meta ?? '', cta: 'Open' },
      openGame,
      'Couldn’t load details'
    );
    root.removeAttribute('aria-busy');
  });
