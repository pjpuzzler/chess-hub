// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { GameView, InitResponse, PostView } from '../shared/api';
import { infoFromInit, renderSplash } from './splash-view';

const EVIL = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
const init = (post: PostView): InitResponse => ({
  type: 'init',
  postId: 't3_x',
  username: EVIL,
  post,
  flags: { anarchy: false },
  canModerate: false,
  create: { review: false, elo: false, poll: false, remainingToday: 0 },
});
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('splash rendering of user text', () => {
  const posts: PostView[] = [
    {
      kind: 'poll',
      fen: START,
      prompt: EVIL,
      lastMove: null,
      closesAt: null,
      totalVotes: 3,
      myVote: null,
      results: null,
    },
    {
      kind: 'review',
      pgn: '1. e4 *',
      white: EVIL,
      black: EVIL,
      result: '*',
      caption: EVIL,
      author: EVIL,
      analysis: null,
    },
    {
      kind: 'elo',
      number: 1,
      game: { pgn: '1. e4 *', timeControl: '600+0', result: '*' },
      myGuess: null,
      myScore: null,
      reveal: null,
      me: null,
      source: 'selfReported',
      author: EVIL,
      caption: EVIL,
    },
  ];

  it.each(posts.map((p) => [p.kind, p] as const))(
    '%s: never parses user text as HTML',
    (_k, post) => {
      const root = document.createElement('main');
      const info = infoFromInit(init(post), Date.now());
      renderSplash(
        root,
        { kind: post.kind, fen: START, orientation: 'white' },
        info,
        () => undefined
      );
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('script')).toBeNull();
      // Elo splashes show no user text at all; the others show it verbatim.
      if (post.kind !== 'elo') expect(root.textContent).toContain('<img src=x');
    }
  );
});

describe('splash copy', () => {
  it('shows the winning move of a closed poll with an arrow', () => {
    const post: PostView = {
      kind: 'poll',
      fen: START,
      prompt: 'White to play',
      lastMove: null,
      closesAt: 1,
      totalVotes: 3,
      myVote: null,
      results: [
        { move: 'e2e4', san: 'e4', votes: 2 },
        { move: 'd2d4', san: 'd4', votes: 1 },
      ],
    };
    const info = infoFromInit(init(post), 1000);
    expect(info.meta).toBe('e4 won with 67%');
    expect(info.arrow).toBe('e2e4');
    const root = document.createElement('main');
    renderSplash(
      root,
      { kind: 'poll', fen: START, orientation: 'white' },
      info,
      () => undefined
    );
    expect(root.querySelector('svg.arrow line')).not.toBeNull();
  });
});

describe('anarchy puzzle', () => {
  it('uses the anarchy label and the tagline', () => {
    const post: PostView = {
      kind: 'puzzle',
      number: 9,
      date: '2026-10-29',
      puzzle: {
        id: 'x',
        fen: START,
        setupMove: 'e2e4',
        solverMoves: 2,
        rating: 1500,
        solution: null,
        themes: null,
      },
      stats: { attempts: 0, cleanSolves: 0 },
      me: null,
      nextPuzzleAt: null,
      tagline: 'Brick rule in effect',
      currentElo: null,
    };
    const info = infoFromInit({ ...init(post), flags: { anarchy: true } }, 0);
    expect(info.label).toBe('Daily Anarchy Puzzle #9');
    expect(info.meta).toBe('Brick rule in effect');
  });
});

describe('community game', () => {
  const game = (over: Partial<GameView> = {}): GameView => ({
    kind: 'game',
    gameNumber: 1,
    moveNumber: 1,
    fen: START,
    turn: 'white',
    lastMove: null,
    moves: [],
    status: 'open',
    totalVotes: 4,
    myVote: null,
    results: null,
    winningMove: null,
    nextPostId: null,
    ...over,
  });

  it('asks for a vote while open, numbering from game 2', () => {
    const first = infoFromInit(init(game()), 0);
    expect(first.label).toBe('Community game');
    expect(first.title).toBe('White to play');
    expect(first.meta).toMatch(/^Move 1 · \d+ votes?$/);
    expect(infoFromInit(init(game({ gameNumber: 2 })), 0).label).toBe(
      'Community game #2'
    );
  });

  it('shows the played move once closed', () => {
    const info = infoFromInit(
      init(
        game({
          status: 'closed',
          results: [{ move: 'e2e4', san: 'e4', votes: 4 }],
          winningMove: { move: 'e2e4', san: 'e4' },
          nextPostId: 't3_next',
        })
      ),
      0
    );
    expect(info.title).toBe('White played e4');
    expect(info.arrow).toBe('e2e4');
  });

  it('names the result post after the game, not "r/x vs r/x"', () => {
    const info = infoFromInit(
      init({
        kind: 'review',
        pgn: '[Event "r/AnarchyChess community game #3"]\n[White "r/AnarchyChess"]\n[Black "r/AnarchyChess"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
        white: 'r/AnarchyChess',
        black: 'r/AnarchyChess',
        result: '0-1',
        caption: 'Black wins by checkmate in 2.',
        author: null,
        analysis: null,
      }),
      0
    );
    expect(info.title).toBe('Community game #3');
    expect(info.meta).toBe('0-1 · Black wins by checkmate in 2.');
  });
});
