// Expanded view: loads /api/init and routes by post kind.
import { context } from '@devvit/web/client';
import type { Color } from 'chessground/types';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { InitResponse, LeaderboardKind } from '../shared/api';
import { displayName, surname } from '../shared/chess/names';
import { solverColor } from '../shared/chess/puzzle';
import {
  AnalysisBoard,
  type AnalysisPosition,
} from './components/AnalysisBoard';
import { PollCreateSheet } from './components/PollCreateSheet';
import { CreateSheet, type CreateKind } from './components/CreateSheet';
import { Board } from './components/Board';
import { EvalBar } from './components/EnginePanel';
import { Screen } from './components/Screen';
import { Button, Icon, NavButton, TextTabs, type Tab } from './components/ui';
import { api } from './lib/api';
import { communityReview, gameLabel } from './lib/community';
import {
  buildLine,
  parsePgn,
  START_FEN,
  turnOf,
  type LineMove,
} from './lib/chess';
import { EloTab } from './views/EloTab';
import { GameTab } from './views/GameTab';
import { Leaderboard } from './views/Leaderboard';
import { PollTab } from './views/PollTab';
import { PuzzleTab } from './views/PuzzleTab';
import { ReviewTab } from './views/ReviewTab';

type TabId = 'main' | 'analyze' | 'leaders';

function postOrientation(): Color | null {
  const data = context.postData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data.orientation;
  return o === 'white' || o === 'black' ? o : null;
}

type AnalysisSetup = {
  startFen: string;
  mainline: LineMove[];
  index: number;
  orientation: Color;
};

function Shell({ init }: { init: InitResponse }) {
  const { post, flags, username, canModerate, create } = init;
  const loggedIn = username !== null;
  const [tab, setTab] = useState<TabId>('main');
  // Review / Elo replay position. A finished review opens on the final
  // position, the same one the splash and the loading board show.
  const [ply, setPly] = useState(() =>
    post.kind === 'review' && post.analysis
      ? (parsePgn(post.pgn)?.moves.length ?? 0)
      : 0
  );
  const [unlocked, setUnlocked] = useState(
    post.kind === 'puzzle'
      ? post.puzzle.solution !== null
      : post.kind === 'poll'
        ? false
        : post.kind === 'elo'
          ? post.myGuess !== null
          : post.kind === 'game'
            ? // No engine while the vote is open.
              post.status !== 'open'
            : true
  );
  const [solution, setSolution] = useState<string[] | null>(
    post.kind === 'puzzle' ? post.puzzle.solution : null
  );
  const [sheet, setSheet] = useState<CreateKind | 'menu' | null>(null);
  // The Analyze board's position, offered as a poll in the + sheet.
  const [analysisPos, setAnalysisPos] = useState<AnalysisPosition | null>(null);
  const [pollFrom, setPollFrom] = useState<AnalysisPosition | null>(null);
  const pollable =
    tab === 'analyze' && create.poll && analysisPos && !analysisPos.over
      ? analysisPos
      : null;
  const unlock = useCallback(() => setUnlocked(true), []);
  const anyCreate = create.review || create.elo || create.poll;

  // Puzzle solutions arrive from the server only once the viewer finishes.
  const onPuzzleFinished = useCallback((line: string[] | null) => {
    setUnlocked(true);
    if (line) setSolution(line);
  }, []);

  const analysis = useMemo<AnalysisSetup>(() => {
    if (post.kind === 'puzzle') {
      return {
        startFen: post.puzzle.fen,
        mainline: buildLine(
          post.puzzle.fen,
          solution ?? [post.puzzle.setupMove]
        ),
        index: 1,
        orientation: solverColor(post.puzzle.fen),
      };
    }
    if (post.kind === 'poll') {
      return {
        startFen: post.fen,
        mainline: [],
        index: 0,
        orientation: postOrientation() ?? turnOf(post.fen),
      };
    }
    if (post.kind === 'game') {
      const played = post.winningMove
        ? [...post.moves, post.winningMove.move]
        : post.moves;
      return {
        startFen: START_FEN,
        mainline: buildLine(START_FEN, played),
        index: post.moves.length,
        orientation: postOrientation() ?? post.turn,
      };
    }
    const parsed = parsePgn(post.kind === 'review' ? post.pgn : post.game.pgn);
    return {
      startFen: parsed?.startFen ?? '',
      mainline: parsed?.moves ?? [],
      index: ply,
      orientation: postOrientation() ?? 'white',
    };
  }, [post, solution, ply]);

  // Header titles, longest first: the first that fits is shown.
  let titles: string[];
  const tabs: Tab<TabId>[] = [];
  let leaderKinds: LeaderboardKind[] = ['streak', 'rating'];
  if (post.kind === 'puzzle') {
    titles = [
      `${flags.anarchy ? 'Daily Anarchy Puzzle' : 'Daily Puzzle'} #${post.number}`,
      `Puzzle #${post.number}`,
      `#${post.number}`,
    ];
    tabs.push({ id: 'main', label: 'Puzzle' });
    if (unlocked) tabs.push({ id: 'analyze', label: 'Analyze' });
    tabs.push({ id: 'leaders', label: 'Leaders' });
  } else if (post.kind === 'poll') {
    titles = [post.prompt, 'What’s the move?', 'Poll'];
    if (unlocked)
      tabs.push(
        { id: 'main', label: 'Vote' },
        { id: 'analyze', label: 'Analyze' }
      );
  } else if (post.kind === 'review') {
    const community = communityReview(post);
    titles = community
      ? [community.full, community.short, 'Game review']
      : [
          `${displayName(post.white)} vs ${displayName(post.black)}`,
          `${surname(post.white)} vs ${surname(post.black)}`,
          'Game review',
        ];
    tabs.push(
      { id: 'main', label: 'Review' },
      { id: 'analyze', label: 'Analyze' }
    );
  } else if (post.kind === 'game') {
    // Whose turn it is is the status line's job.
    titles = [
      `${gameLabel(post.gameNumber)} · Move ${post.moveNumber}`,
      `${gameLabel(post.gameNumber).replace('Community game', 'Game')} · Move ${post.moveNumber}`,
      `Move ${post.moveNumber}`,
    ];
    if (unlocked)
      tabs.push(
        { id: 'main', label: 'Game' },
        { id: 'analyze', label: 'Analyze' }
      );
  } else {
    titles = [`Guess the Elo #${post.number}`, `Elo #${post.number}`];
    leaderKinds = ['elo'];
    tabs.push({ id: 'main', label: 'Game' });
    if (unlocked) tabs.push({ id: 'analyze', label: 'Analyze' });
    tabs.push({ id: 'leaders', label: 'Leaders' });
  }

  return (
    <div className="app">
      <header className="topbar">
        <FitTitle titles={titles} />
        <div className="topbar-end">
          {tabs.length > 1 ? (
            <TextTabs label="View" tabs={tabs} value={tab} onChange={setTab} />
          ) : null}
          {anyCreate ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Post something"
              onClick={() => setSheet('menu')}
            >
              <Icon name="plus" />
            </button>
          ) : null}
        </div>
      </header>

      <main className="content">
        {/* Kept laid out (not display: none) while another tab shows, so its
            board keeps a real size and Chessground never draws into a
            zero-size box. */}
        <div
          className={tab === 'main' ? 'tab' : 'tab tab-away'}
          inert={tab !== 'main'}
          aria-hidden={tab !== 'main'}
        >
          {post.kind === 'puzzle' ? (
            <PuzzleTab
              view={post}
              active={tab === 'main'}
              loggedIn={loggedIn}
              anarchy={flags.anarchy}
              onFinished={onPuzzleFinished}
            />
          ) : post.kind === 'poll' ? (
            <PollTab
              view={post}
              orientation={analysis.orientation}
              loggedIn={loggedIn}
              anarchy={flags.anarchy}
              canAsk={create.poll}
              onAsk={() => setSheet('poll')}
              onReveal={unlock}
            />
          ) : post.kind === 'review' ? (
            <ReviewTab
              view={post}
              orientation={analysis.orientation}
              active={tab === 'main'}
              ply={ply}
              onPly={setPly}
            />
          ) : post.kind === 'game' ? (
            <GameTab
              view={post}
              orientation={analysis.orientation}
              active={tab === 'main'}
              loggedIn={loggedIn}
              anarchy={flags.anarchy}
            />
          ) : (
            <EloTab
              view={post}
              loggedIn={loggedIn}
              active={tab === 'main'}
              ply={ply}
              onPly={setPly}
              canPost={create.elo}
              onPost={() => setSheet('elo')}
              onGuessed={unlock}
            />
          )}
        </div>
        {tab === 'analyze' && unlocked ? (
          <AnalysisBoard
            startFen={analysis.startFen}
            mainline={analysis.mainline}
            initialIndex={analysis.index}
            orientation={analysis.orientation}
            anarchy={flags.anarchy}
            onPosition={setAnalysisPos}
          />
        ) : null}
        {tab === 'leaders' ? (
          <Leaderboard
            username={username}
            canModerate={canModerate}
            kinds={leaderKinds}
          />
        ) : null}
      </main>

      {sheet ? (
        <CreateSheet
          options={create}
          initial={sheet === 'menu' ? null : sheet}
          onClose={() => setSheet(null)}
          onPollPosition={
            pollable
              ? () => {
                  setSheet(null);
                  setPollFrom(pollable);
                }
              : undefined
          }
        />
      ) : null}
      {pollFrom ? (
        <PollCreateSheet
          fen={pollFrom.fen}
          lastMove={pollFrom.lastMove}
          orientation={pollFrom.orientation}
          remaining={create.remainingToday}
          onClose={() => setPollFrom(null)}
        />
      ) : null}
    </div>
  );
}

// The longest title that fits on one line, never cut off with an ellipsis.
function FitTitle({ titles }: { titles: string[] }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [index, setIndex] = useState(0);
  const key = titles.join('\n');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pen = document.createElement('canvas').getContext('2d');
    const fit = () => {
      if (!pen) return;
      pen.font = getComputedStyle(el).font;
      const room = el.clientWidth;
      const i = titles.findIndex((t) => pen.measureText(t).width <= room);
      setIndex(i < 0 ? titles.length - 1 : i);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // `key` stands for the titles' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <h1 ref={ref} className="title" title={titles[0]}>
      {titles[index]}
    </h1>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; init: InitResponse };

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .init()
      .then((init) => live && setState({ status: 'ok', init }))
      .catch((err: unknown) => {
        console.error('init failed', err);
        if (live)
          setState({ status: 'error', message: 'Couldn’t load this post.' });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (state.status === 'ok') return <Shell init={state.init} />;
  if (state.status === 'loading') return <Loading />;
  return (
    <div className="app">
      <div className="center-state">
        <p>{state.message}</p>
        <Button
          variant="primary"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

// Before /api/init returns: the real layout for this post kind, with the
// board already on the position from postData, so nothing moves on load.
function Loading() {
  const data = context.postData;
  const fen =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof data.fen === 'string'
      ? data.fen
      : START_FEN;
  const kind =
    data && typeof data === 'object' && !Array.isArray(data) ? data.kind : null;
  const withNav = kind === 'review' || kind === 'elo';
  // Elo replays from the first move (postData holds the final position for
  // the splash preview).
  const boardFen = kind === 'elo' ? START_FEN : fen;
  return (
    <div className="app" aria-busy="true" aria-label="Loading">
      <header className="topbar">
        <h1 className="title"> </h1>
      </header>
      <main className="content">
        <Screen
          evalBar={
            kind === 'review' ? (
              <EvalBar share={null} label="" orientation="white" hidden />
            ) : undefined
          }
          board={
            <Board
              fen={boardFen}
              orientation={postOrientation() ?? 'white'}
              interactive={false}
              sounds={false}
            />
          }
          strip={kind === 'poll' ? undefined : <div />}
          // The same info rows each view reserves, and the same folding on
          // short screens, so the board doesn't move.
          compact={<span />}
          infoRows={2}
          nav={
            withNav ? (
              <>
                <NavButton icon="first" label="Start" disabled />
                <NavButton icon="prev" label="Previous move" disabled />
                <NavButton icon="next" label="Next move" disabled />
                <NavButton icon="last" label="Last move" disabled />
                <NavButton icon="flip" label="Flip board" disabled />
              </>
            ) : (
              <span />
            )
          }
        />
      </main>
    </div>
  );
}
