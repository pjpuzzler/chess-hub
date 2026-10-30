import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { navigateToPost } from '@devvit/web/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PuzzleMe, PuzzleStats, PuzzleView } from '../../shared/api';
import { fenAtPly, solverColor } from '../../shared/chess/puzzle';
import { Board } from '../components/Board';
import { MoveInput } from '../components/MoveInput';
import { MoveStrip } from '../components/MoveStrip';
import { Screen } from '../components/Screen';
import {
  Button,
  Icon,
  Line,
  LoginButton,
  NavButton,
  ShareButton,
} from '../components/ui';
import { holyHell } from '../lib/anarchy';
import { api, friendlyError } from '../lib/api';
import { buildLine, playMove, toKey, uciKeys } from '../lib/chess';
import { duration } from '../lib/format';
import { sound } from '../lib/sound';
import { themeLabels } from '../lib/themes';
import { useMoveKeys } from '../lib/useMoveKeys';

// 'locked': a logged-out miss ends the try (the server doesn't track it).
type Phase = 'play' | 'waiting' | 'opponent' | 'wrong' | 'locked' | 'done';
// How the viewer finished, for the result copy.
type Finish = 'clean' | 'hint' | 'mistake' | 'revealed' | 'earlier';

const REPLY_DELAY = 380;
const WRONG_SHOW_MS = 700;
const SOLUTION_STEP_MS = 550;

type Props = {
  view: PuzzleView;
  active: boolean; // the tab is showing (arrow keys step the solution)
  loggedIn: boolean;
  anarchy: boolean;
  onFinished: (solution: string[] | null) => void;
};

export function PuzzleTab({
  view,
  active,
  loggedIn,
  anarchy,
  onFinished,
}: Props) {
  const { puzzle } = view;
  const solver = solverColor(puzzle.fen);
  const solverName = solver === 'white' ? 'White' : 'Black';
  const finishedEarlier = puzzle.solution !== null;

  // Every move played from puzzle.fen (setup move first).
  const [line, setLine] = useState<string[]>(() =>
    // Start on the solver's position (the setup move already played and
    // highlighted), exactly what the splash and the loading board show.
    finishedEarlier ? (puzzle.solution ?? []) : [puzzle.setupMove]
  );
  const [solverMoves, setSolverMoves] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>(finishedEarlier ? 'done' : 'play');
  const [finish, setFinish] = useState<Finish | null>(
    finishedEarlier ? 'earlier' : null
  );
  const [mistake, setMistake] = useState(false);
  // What the status line says between moves; set only at transitions, so a
  // late timer or response can't bring back an old message.
  const [note, setNote] = useState<'none' | 'good' | 'retry'>('none');
  // Bumped on every new move or give-up: responses for older ones are ignored.
  const seq = useRef(0);
  const [hint, setHint] = useState<{ move: string; level: 1 | 2 } | null>(null);
  const [hinted, setHinted] = useState(false);
  const [wrongSquare, setWrongSquare] = useState<Key | null>(null);
  const [me, setMe] = useState<PuzzleMe | null>(view.me);
  const [stats, setStats] = useState<PuzzleStats>(view.stats);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  const [themes, setThemes] = useState<string[]>(puzzle.themes ?? []);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [typing, setTyping] = useState(false);
  // Finished: the ply being looked at (null follows the end of the line).
  const [at, setAt] = useState<number | null>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Keep "next puzzle in" fresh.
  useEffect(() => {
    if (phase !== 'done' || view.nextPuzzleAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [phase, view.nextPuzzleAt]);

  const fen = useMemo(
    () => fenAtPly(puzzle.fen, line, line.length),
    [puzzle.fen, line]
  );
  const moves = useMemo(() => buildLine(puzzle.fen, line), [puzzle.fen, line]);
  const done = phase === 'done';
  const shown = done ? (at ?? line.length) : line.length;
  const go = useCallback(
    (i: number) => setAt(Math.max(0, Math.min(line.length, i))),
    [line.length]
  );
  useMoveKeys(active && done, shown, line.length, go);

  const applyResult = (r: {
    me: PuzzleMe | null;
    stats: PuzzleStats;
    ratingDelta: number;
  }) => {
    setStats(r.stats);
    if (r.me) setMe(r.me);
    // Only the response that set the first attempt carries a change.
    if (r.ratingDelta !== 0) setRatingDelta(r.ratingDelta);
  };

  const complete = (
    kind: Finish,
    nextThemes: string[] | null,
    solution: string[] | null
  ) => {
    setPhase('done');
    setFinish(kind);
    setHint(null);
    setTyping(false);
    if (nextThemes) setThemes(nextThemes);
    onFinished(solution);
  };

  const onMove = async (uci: string) => {
    if (phase !== 'play') return;
    const played = playMove(fen, uci);
    if (!played) return;
    if (played.enPassant && anarchy) holyHell();
    const before = line;
    const moves = [...solverMoves, uci];
    const id = ++seq.current;
    setLine([...before, uci]);
    setPhase('waiting');
    setError(null);
    let res;
    try {
      res = await api.puzzleMove(moves);
    } catch (err) {
      if (id !== seq.current) return;
      console.error('puzzle move failed', err);
      setError(friendlyError(err));
      setLine(before);
      setPhase('play');
      return;
    }
    if (id !== seq.current) return;
    if (res.me || res.ratingDelta !== 0) applyResult(res);
    else setStats(res.stats);
    if (!res.correct) {
      setMistake(true);
      setNote('retry');
      setWrongSquare(toKey(uci.slice(2, 4)) ?? null);
      setPhase('wrong');
      sound('fail');
      later(() => {
        if (id !== seq.current) return;
        setLine(before);
        setWrongSquare(null);
        setPhase(loggedIn ? 'play' : 'locked');
      }, WRONG_SHOW_MS);
      return;
    }
    setSolverMoves(moves);
    setHint(null);
    if (res.done) {
      setNote('none');
      sound('success');
      complete(
        mistake ? 'mistake' : hinted ? 'hint' : 'clean',
        res.themes,
        res.solution
      );
      return;
    }
    setNote('good');
    setPhase('opponent');
    const reply = res.reply;
    later(() => {
      if (id !== seq.current) return;
      if (reply) setLine((l) => [...l, reply]);
      setNote('none');
      setPhase('play');
    }, REPLY_DELAY);
  };

  const askHint = async () => {
    if (phase !== 'play') return;
    if (hint?.level === 1) {
      setHint({ ...hint, level: 2 });
      return;
    }
    try {
      const res = await api.puzzleHint(solverMoves);
      setHinted(true);
      setHint({ move: res.move, level: 1 });
    } catch (err) {
      console.error('hint failed', err);
      setError(friendlyError(err));
    }
  };

  const reveal = async () => {
    if (phase !== 'play' && phase !== 'wrong') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const id = ++seq.current;
    setPhase('waiting');
    setNote('none');
    let res;
    try {
      res = await api.puzzleReveal();
    } catch (err) {
      if (id !== seq.current) return;
      console.error('reveal failed', err);
      setError(friendlyError(err));
      setPhase('play');
      return;
    }
    if (id !== seq.current) return;
    applyResult(res);
    // Play the rest of the line from where the solver is.
    const done = solverMoves.length * 2 + 1;
    const solution = res.solution;
    setLine(solution.slice(0, done));
    setWrongSquare(null);
    for (let n = done + 1, i = 0; n <= solution.length; n++, i++) {
      const count = n;
      later(
        () => setLine(solution.slice(0, count)),
        (i + 1) * SOLUTION_STEP_MS
      );
    }
    later(
      () => complete('revealed', res.themes, res.solution),
      Math.max(0, solution.length - done) * SOLUTION_STEP_MS
    );
  };

  const shapes = useMemo<DrawShape[]>(() => {
    const keys = hint ? uciKeys(hint.move) : undefined;
    if (!keys || phase !== 'play') return [];
    return hint?.level === 1
      ? [{ orig: keys[0], brush: 'green' }]
      : [{ orig: keys[0], dest: keys[1], brush: 'green' }];
  }, [hint, phase]);

  const highlights = useMemo(
    () =>
      wrongSquare ? new Map<Key, string>([[wrongSquare, 'wrong']]) : undefined,
    [wrongSquare]
  );

  // ---- copy ----
  let top: { tone?: 'good' | 'bad' | 'muted'; text: string };
  let doneNote: string | null = null;
  if (phase === 'done') {
    if (finish === 'earlier') {
      top =
        me?.status === 'solved'
          ? { tone: 'good', text: 'Solved today' }
          : { text: 'Solution shown' };
    } else if (finish === 'revealed') {
      top = { text: 'Solution shown' };
    } else if (finish === 'mistake') {
      top = { tone: 'good', text: 'Solved' };
      doneNote = 'Not a clean solve';
    } else {
      top = { tone: 'good', text: 'Solved!' };
      doneNote = finish === 'hint' ? 'Solved with a hint.' : null;
    }
  } else if (phase === 'wrong' || phase === 'locked') {
    top = { tone: 'bad', text: 'Not the move' };
  } else if (note === 'good') {
    top = { tone: 'good', text: 'Best move! Keep going' };
  } else if (note === 'retry') {
    top = { tone: 'bad', text: 'Try again' };
  } else if (solverMoves.length > 0) {
    top = { text: 'Your move' };
  } else {
    top = { text: view.tagline ?? `Find the best move for ${solverName}` };
  }

  const shareText =
    finish === 'clean'
      ? `I solved this Daily Puzzle clean. Can you?`
      : finish === 'revealed'
        ? `This Daily Puzzle beat me. Can you solve it?`
        : `I finished today’s puzzle. Can you solve it clean?`;

  // Plain-language stats: the first-try rate only once enough people tried.
  const firstTry =
    stats.attempts >= 20
      ? `${Math.round((100 * stats.cleanSolves) / stats.attempts)}% solved it first try`
      : null;
  const nextIn =
    view.nextPuzzleAt !== null && view.nextPuzzleAt > now
      ? duration(view.nextPuzzleAt - now)
      : null;
  const tactic = themeLabels(themes)[0];

  let summary;
  let extra = null;
  if (phase === 'done') {
    summary = me ? (
      <span>
        Your rating <strong>{me.rating}</strong>
        {ratingDelta ? (
          <span className={ratingDelta > 0 ? 'tone-good' : 'tone-bad'}>
            {' '}
            {ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta}
          </span>
        ) : null}
        {nextIn ? <span className="muted"> · Next in {nextIn}</span> : null}
      </span>
    ) : (
      <>
        <LoginButton>Log in to keep a streak</LoginButton>
        {nextIn ? <span className="muted">Next in {nextIn}</span> : null}
      </>
    );
    const elo = view.currentElo;
    extra = elo ? (
      <div className="info-row">
        <Button
          variant="link"
          onClick={() => {
            if (isPostId(elo.postId)) navigateToPost(elo.postId);
          }}
        >
          This week: Guess the Elo #{elo.number}
        </Button>
      </div>
    ) : tactic || firstTry ? (
      <div className="info-row muted">
        {[tactic ? `Tactic: ${tactic}` : null, firstTry]
          .filter(Boolean)
          .join(' · ')}
      </div>
    ) : null;
    // Two rows, no sheet: the Elo link earns row two when there is one.
  } else if (phase === 'locked') {
    summary = <LoginButton>Log in to try again</LoginButton>;
  } else {
    // How hard it is, without giving anything away.
    extra = (
      <div className="info-row muted">
        {firstTry ??
          (stats.attempts > 0
            ? `${stats.attempts} ${stats.attempts === 1 ? 'try' : 'tries'} so far`
            : 'Be the first to solve it')}
      </div>
    );
    summary = typing ? (
      <MoveInput
        fen={fen}
        disabled={phase !== 'play'}
        onMove={(u) => void onMove(u)}
        onClose={() => setTyping(false)}
      />
    ) : (
      <span className="muted">
        {error ? (
          <span className="tone-bad">{error}</span>
        ) : (
          `Rated ${puzzle.rating} · ${puzzle.solverMoves} ${puzzle.solverMoves === 1 ? 'move' : 'moves'} to find`
        )}
      </span>
    );
  }

  const typeButton = (
    <NavButton
      icon="keyboard"
      label="Type"
      showLabel
      aria-pressed={typing}
      onClick={() => setTyping((t) => !t)}
      disabled={phase === 'waiting' || phase === 'opponent'}
    />
  );
  let nav;
  if (done) {
    nav = (
      <>
        <NavButton
          icon="first"
          label="Start"
          onClick={() => go(0)}
          disabled={shown === 0}
        />
        <NavButton
          icon="prev"
          label="Previous move"
          onClick={() => go(shown - 1)}
          disabled={shown === 0}
        />
        <NavButton
          icon="next"
          label="Next move"
          onClick={() => go(shown + 1)}
          disabled={shown >= line.length}
        />
        <NavButton
          icon="last"
          label="Last move"
          onClick={() => go(line.length)}
          disabled={shown >= line.length}
        />
      </>
    );
  } else if (phase === 'locked') {
    nav = undefined;
  } else if (!loggedIn) {
    // Hints and the solution need an account (the server records them).
    nav = typeButton;
  } else {
    nav = (
      <>
        <NavButton
          icon="hint"
          label={hint?.level === 1 ? 'Show the move' : 'Hint'}
          showLabel
          onClick={() => void askHint()}
          disabled={phase !== 'play' || hint?.level === 2}
        />
        {typeButton}
        {mistake || hinted ? (
          <NavButton
            icon="eye"
            label="Solution"
            showLabel
            onClick={() => void reveal()}
            disabled={phase !== 'play' && phase !== 'wrong'}
          />
        ) : null}
      </>
    );
  }

  const shownFen = done ? fenAtPly(puzzle.fen, line, shown) : fen;
  // The status line; on short screens it is the only row under the board,
  // so the rating rides along once the puzzle is done.
  const statusLine = (
    <>
      <Line tone={top.tone}>
        {top.text}
        {doneNote ? <span className="muted"> · {doneNote}</span> : null}
        {done && me ? (
          <span className="muted compact-only">
            {' '}
            · Rating <strong>{me.rating}</strong>
          </span>
        ) : null}
      </Line>
      <span className="top-end">
        {me ? (
          <span className="streak" aria-label={`Streak ${me.streak}`}>
            <Icon name="flame" size={16} />
            {me.streak}
          </span>
        ) : null}
        {done && loggedIn ? <ShareButton text={shareText} /> : null}
      </span>
    </>
  );
  return (
    <Screen
      top={<div className="top-row">{statusLine}</div>}
      compact={
        typing && phase !== 'done' ? (
          <MoveInput
            fen={fen}
            disabled={phase !== 'play'}
            onMove={(u) => void onMove(u)}
            onClose={() => setTyping(false)}
          />
        ) : (
          statusLine
        )
      }
      board={
        <Board
          fen={shownFen}
          orientation={solver}
          lastMove={uciKeys(line[shown - 1])}
          interactive={phase === 'play'}
          shapes={shapes}
          highlights={highlights}
          onMove={(u) => void onMove(u)}
          label={`Puzzle board, ${solverName} to play`}
        />
      }
      strip={
        <MoveStrip
          startFen={puzzle.fen}
          moves={moves}
          index={shown}
          onSelect={done ? go : () => undefined}
        />
      }
      summary={summary}
      extra={extra}
      infoRows={2}
      nav={nav}
    />
  );
}

const isPostId = (id: string): id is `t3_${string}` => id.startsWith('t3_');
