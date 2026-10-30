// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type {
  GameView,
  InitResponse,
  PostCard,
  PostData,
  PostView,
} from '../shared/api';
import {
  infoFromInit,
  infoFromPostData,
  readPostData,
  renderSplash,
} from './splash-view';

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
      tagline: 'Google en passant',
      currentElo: null,
    };
    const info = infoFromInit({ ...init(post), flags: { anarchy: true } }, 0);
    expect(info.label).toBe('Daily Anarchy Puzzle #9');
    expect(info.meta).toBe('Google en passant');
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

describe('card text from postData (before init)', () => {
  const data = (card: PostCard, orientation: 'white' | 'black' = 'white') =>
    readPostData({ kind: card.kind, fen: START, orientation, card });

  // Each fixed card next to the init view a viewer who has not taken part
  // gets for the same post: label, title and button must match so the swap
  // moves nothing; meta matches where it is known up front.
  const pairs: [string, PostData | null, InitResponse][] = [
    [
      'puzzle',
      data(
        {
          kind: 'puzzle',
          number: 9,
          rating: 1612,
          tagline: null,
          anarchy: false,
        },
        'black'
      ),
      init({
        kind: 'puzzle',
        number: 9,
        date: '2026-10-29',
        // White to move before the setup move, so Black solves.
        puzzle: {
          id: 'x',
          fen: START,
          setupMove: 'e2e4',
          solverMoves: 2,
          rating: 1612,
          solution: null,
          themes: null,
        },
        stats: { attempts: 0, cleanSolves: 0 },
        me: null,
        nextPuzzleAt: null,
        tagline: null,
        currentElo: null,
      }),
    ],
    [
      'anarchy puzzle',
      data({
        kind: 'puzzle',
        number: 9,
        rating: 1612,
        tagline: 'Google en passant',
        anarchy: true,
      }),
      {
        ...init({
          kind: 'puzzle',
          number: 9,
          date: '2026-10-29',
          puzzle: {
            id: 'x',
            fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
            setupMove: 'e7e5',
            solverMoves: 2,
            rating: 1612,
            solution: null,
            themes: null,
          },
          stats: { attempts: 0, cleanSolves: 0 },
          me: null,
          nextPuzzleAt: null,
          tagline: 'Google en passant',
          currentElo: null,
        }),
        flags: { anarchy: true },
      },
    ],
    [
      'poll',
      data({ kind: 'poll', prompt: 'Find the win' }),
      init({
        kind: 'poll',
        fen: START,
        prompt: 'Find the win',
        lastMove: null,
        closesAt: null,
        totalVotes: 3,
        myVote: null,
        results: null,
      }),
    ],
    [
      'review',
      data({
        kind: 'review',
        white: 'Carlsen, Magnus',
        black: 'Nakamura, Hikaru',
        result: '1-0',
        caption: 'Wild one',
        game: null,
      }),
      init({
        kind: 'review',
        pgn: '1. e4 1-0',
        white: 'Carlsen, Magnus',
        black: 'Nakamura, Hikaru',
        result: '1-0',
        caption: 'Wild one',
        author: 'someone',
        analysis: null,
      }),
    ],
    [
      'community result',
      data({
        kind: 'review',
        white: 'r/AnarchyChess',
        black: 'r/AnarchyChess',
        result: '0-1',
        caption: 'Black wins by checkmate in 2.',
        game: 3,
      }),
      init({
        kind: 'review',
        pgn: '[Event "r/AnarchyChess community game #3"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
        white: 'r/AnarchyChess',
        black: 'r/AnarchyChess',
        result: '0-1',
        caption: 'Black wins by checkmate in 2.',
        author: null,
        analysis: null,
      }),
    ],
    [
      'elo',
      data({ kind: 'elo', number: 4, timeControl: '600+0' }),
      init({
        kind: 'elo',
        number: 4,
        game: { pgn: '1. e4 *', timeControl: '600+0', result: '*' },
        myGuess: null,
        myScore: null,
        reveal: null,
        me: null,
        source: 'curated',
        author: null,
        caption: '',
      }),
    ],
    [
      'community game',
      data({ kind: 'game', gameNumber: 2, moveNumber: 1 }, 'white'),
      init({
        kind: 'game',
        gameNumber: 2,
        moveNumber: 1,
        fen: START,
        turn: 'white',
        lastMove: null,
        moves: [],
        status: 'open',
        totalVotes: 0,
        myVote: null,
        results: null,
        winningMove: null,
        nextPostId: null,
      }),
    ],
  ];

  it.each(pairs)('%s: matches what init shows', (_name, postData, live) => {
    expect(postData?.card).toBeDefined();
    const early = infoFromPostData(postData);
    const after = infoFromInit(live, 0);
    expect(early.label).toBe(after.label);
    expect(early.title).toBe(after.title);
    expect(early.cta).toBe(after.cta);
    expect(early.done).toBe(false);
    if (early.meta !== null) expect(early.meta).toBe(after.meta);
  });

  it('shows vote counts as a placeholder in the meta line', () => {
    const postData = data({ kind: 'poll', prompt: EVIL });
    const root = document.createElement('main');
    renderSplash(root, postData, infoFromPostData(postData), () => undefined);
    expect(root.querySelector('.title')?.textContent).toBe(EVIL);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.meta .skeleton.text')).not.toBeNull();
  });

  it('old posts without card text keep the loading placeholders', () => {
    const old = readPostData({
      kind: 'poll',
      fen: START,
      orientation: 'white',
    });
    expect(old).toEqual({ kind: 'poll', fen: START, orientation: 'white' });
    const info = infoFromPostData(old);
    expect(info.title).toBeNull();
    expect(info.label).toBe('What’s the move?');
  });

  it('drops malformed or mismatched card text', () => {
    const bad = [
      { kind: 'elo', number: 4, timeControl: '600+0' }, // wrong kind
      { kind: 'poll' }, // no prompt
      { kind: 'poll', prompt: 7 },
      'Find the win',
    ];
    for (const card of bad) {
      const pd = readPostData({ kind: 'poll', fen: START, card });
      expect(pd?.card).toBeUndefined();
      expect(infoFromPostData(pd).title).toBeNull();
    }
    expect(readPostData({ kind: 'nope', fen: START })).toBeNull();
  });
});
