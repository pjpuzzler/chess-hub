import type { DrawShape } from 'chessground/draw';
import type { Color, Key } from 'chessground/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineScore, ReviewAnalysis, ReviewView } from '../../shared/api';
import {
  parseGame,
  summarizeReview,
  validateAnalysis,
  winPercent,
  type MoveClass,
  type ParsedGame,
  type Side,
} from '../../shared/chess/review';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EnginePanel';
import { ENGINE_LABEL } from '../lib/engine-text';
import { MoveStrip, type StripMove } from '../components/MoveStrip';
import { Screen } from '../components/Screen';
import { Button, Line, NavButton, ShareLink } from '../components/ui';
import { WinGraph } from '../components/WinGraph';
import { displayName, surname } from '../../shared/chess/names';
import {
  BatchAnalyzer,
  REVIEW_DEPTH,
  type BatchProgress,
} from '../engine/batch';
import { formatScore } from '../engine/uci';
import { api, friendlyError } from '../lib/api';
import { communityReview } from '../lib/community';
import {
  buildLine,
  gameEnd,
  playMove,
  toKey,
  turnOf,
  uciKeys,
} from '../lib/chess';
import { useMoveKeys } from '../lib/useMoveKeys';

// Lichess-style terse marks: errors, plus !! for sound sacrifices.
const GLYPH: Partial<Record<MoveClass, string>> = {
  brilliant: '!!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  missedMate: '??',
};
const NOUN: Record<MoveClass, string> = {
  brilliant: 'brilliant',
  best: 'best',
  excellent: 'excellent',
  good: 'good',
  inaccuracy: 'an inaccuracy',
  mistake: 'a mistake',
  blunder: 'a blunder',
  missedMate: 'a missed win',
};
const BAD: ReadonlySet<MoveClass> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
  'missedMate',
]);
const toneOf = (c: MoveClass) => (c === 'missedMate' ? 'blunder' : c);
const SIDES: Side[] = ['white', 'black'];

const scoreLabel = (s: EngineScore) =>
  'mate' in s ? formatScore({ mate: s.mate }) : formatScore({ cp: s.cp });

type Run =
  | { status: 'idle' }
  | { status: 'running'; progress: BatchProgress }
  | { status: 'saving' }
  | { status: 'error'; message: string };

type Props = {
  view: ReviewView;
  orientation: Color;
  active: boolean;
  ply: number;
  onPly: (ply: number) => void;
};

export function ReviewTab(props: Props) {
  const { view } = props;
  const game = useMemo(() => {
    const parsed = parseGame(view.pgn);
    // Community game: the subreddit played both sides, so name the colours.
    return communityReview(view) && !('error' in parsed)
      ? { ...parsed, white: 'White', black: 'Black' }
      : parsed;
  }, [view]);
  if ('error' in game) {
    return <p className="line tone-bad pad">This game couldn’t be read.</p>;
  }
  return <Review {...props} game={game} />;
}

function Review({
  view,
  game,
  orientation: initial,
  active,
  ply,
  onPly,
}: Props & { game: ParsedGame }) {
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(
    view.analysis
  );
  const [run, setRun] = useState<Run>(() =>
    view.analysis
      ? { status: 'idle' }
      : {
          status: 'running',
          progress: { fraction: 0 },
        }
  );
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Color>(initial);
  const analyzer = useRef<BatchAnalyzer | null>(null);
  const plies = game.moves.length;
  const line = useMemo(() => buildLine(game.startFen, game.moves), [game]);

  const execute = async (a: BatchAnalyzer) => {
    try {
      const raw = await a.review(game, (progress) =>
        setRun({ status: 'running', progress })
      );
      const valid = validateAnalysis(raw, game.fens);
      if ('error' in valid)
        throw new Error(`Engine output rejected: ${valid.error}`);
      setRun({ status: 'saving' });
      try {
        // The server keeps the first valid analysis; render whatever it stored.
        const res = await api.reviewAnalysis(valid);
        setAnalysis(res.analysis);
        onPly(game.moves.length);
      } catch (err) {
        console.error('saving review failed', err);
        setAnalysis(valid);
        onPly(game.moves.length);
        setSaveNote('Not saved, so others won’t see this yet.');
      }
      setRun({ status: 'idle' });
    } catch (err) {
      if (analyzer.current !== a) return; // cancelled or superseded
      console.error('review run failed', err);
      setRun({ status: 'error', message: 'Engine unavailable on this device' });
    } finally {
      if (analyzer.current === a) analyzer.current = null;
    }
  };

  // Auto-start once when nobody has reviewed the game yet.
  useEffect(() => {
    if (view.analysis) return;
    const a = new BatchAnalyzer();
    analyzer.current = a;
    // Deferred so the first paint isn't blocked by the worker boot.
    const timer = setTimeout(() => void execute(a), 0);
    return () => {
      clearTimeout(timer);
      analyzer.current = null;
      a.cancel();
    };
    // Mount-only: later runs come from the Run button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    const a = new BatchAnalyzer();
    analyzer.current = a;
    setRun({
      status: 'running',
      progress: { fraction: 0 },
    });
    void execute(a);
  };
  const cancel = () => {
    const a = analyzer.current;
    analyzer.current = null;
    a?.cancel();
    setRun({ status: 'idle' });
  };

  // Author/moderator: replace the stored review (two taps).
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const rerun = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setResetError(null);
    try {
      await api.reviewReset();
    } catch (err) {
      console.error('review reset failed', err);
      setResetError(friendlyError(err));
      return;
    }
    setAnalysis(null);
    setSaveNote(null);
    onPly(0);
    start();
  };

  const summary = useMemo(
    () =>
      analysis
        ? summarizeReview(
            analysis.positions,
            game.moves,
            game.firstMover,
            game.fens
          )
        : null,
    [analysis, game]
  );
  const pcts = useMemo(
    () => analysis?.positions.map((p) => winPercent(p.score)) ?? [],
    [analysis]
  );

  const go = useCallback(
    (i: number) => onPly(Math.max(0, Math.min(plies, i))),
    [onPly, plies]
  );
  useMoveKeys(active && analysis !== null, ply, plies, go);

  // Before the review exists, show the final position.
  const shown = analysis ? ply : plies;
  const fen = game.fens[shown] ?? game.startFen;
  const played = shown > 0 ? summary?.plies[shown - 1] : undefined;
  const bestBefore = shown > 0 ? analysis?.positions[shown - 1]?.best : null;
  const shapes = useMemo<DrawShape[]>(() => {
    if (!played || !BAD.has(played.cls) || !bestBefore) return [];
    const keys = uciKeys(bestBefore);
    return keys ? [{ orig: keys[0], dest: keys[1], brush: 'green' }] : [];
  }, [played, bestBefore]);
  const highlights = useMemo(() => {
    const dest = played ? toKey(played.move.slice(2, 4)) : undefined;
    return dest && played && BAD.has(played.cls)
      ? new Map<Key, string>([[dest, `cls-${toneOf(played.cls)}`]])
      : undefined;
  }, [played]);
  const score = analysis?.positions[shown]?.score;

  const strip: StripMove[] = line.map((m, i) => {
    const c = summary?.plies[i]?.cls;
    return {
      san: m.san,
      glyph: c ? GLYPH[c] : undefined,
      tone: c ? toneOf(c) : undefined,
    };
  });

  // ---- top line ----
  let top;
  const end = gameEnd(fen);
  if (!analysis) {
    top =
      run.status === 'running' || run.status === 'saving' ? (
        <Line tone="muted">Reviewing the game…</Line>
      ) : null;
  } else if (played) {
    const san = line[shown - 1]?.san ?? '';
    const bestSan =
      bestBefore && BAD.has(played.cls)
        ? (playMove(game.fens[shown - 1] ?? fen, bestBefore)?.san ?? bestBefore)
        : null;
    // After mate or stalemate the board result replaces any mate count.
    const evalText =
      end === 'checkmate'
        ? turnOf(fen) === 'white'
          ? '0-1'
          : '1-0'
        : end
          ? '½-½'
          : score
            ? scoreLabel(score)
            : '';
    const text =
      end === 'checkmate'
        ? 'Checkmate'
        : end
          ? 'Draw'
          : `${san} is ${NOUN[played.cls]}.${bestSan && bestSan !== san ? ` ${bestSan} was best.` : ''}`;
    top = (
      <p className="verdict">
        <span className={`verdict-text c-${toneOf(played.cls)}`}>{text}</span>
        {evalText ? <span className="verdict-eval">{evalText}</span> : null}
      </p>
    );
  } else {
    top = null;
  }

  // ---- info row; graph and counts behind Details ----
  const acc = (v: number | null | undefined) =>
    v === null || v === undefined ? '–' : v.toFixed(1);
  let panelSummary;
  let panelExtra = null;
  let body = null;
  if (!analysis) {
    if (run.status === 'running' || run.status === 'saving')
      panelExtra = (
        <div className="info-row muted">
          {ENGINE_LABEL} · depth {REVIEW_DEPTH} · on this device
        </div>
      );
    panelSummary =
      run.status === 'running' ? (
        <>
          <div
            className="progress grow"
            role="progressbar"
            aria-label="Review progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(100 * run.progress.fraction)}
          >
            <span style={{ width: `${100 * run.progress.fraction}%` }} />
          </div>
          <Button onClick={cancel}>Cancel</Button>
        </>
      ) : run.status === 'saving' ? null : (
        <>
          {run.status === 'error' ? (
            <Line tone="bad">{run.message}</Line>
          ) : null}
          <Button variant="primary" onClick={start} className="grow">
            Review game
          </Button>
        </>
      );
  } else if (summary) {
    // One row per player: name, error marks, accuracy.
    const marks = (side: Side) =>
      (
        [
          ['??', 'blunder', ['blunder', 'missedMate']],
          ['?', 'mistake', ['mistake']],
          ['?!', 'inaccuracy', ['inaccuracy']],
        ] satisfies [string, string, MoveClass[]][]
      )
        .map(([glyph, tone, classes]) => ({
          glyph,
          tone,
          n: classes.reduce((t, c) => t + summary.counts[side][c], 0),
        }))
        .filter((m) => m.n > 0);
    const playerRow = (side: Side) => (
      <div className="info-row player-row" key={side}>
        <span className={`disc ${side}`} aria-hidden="true" />
        <span className="player-name">
          {surname(side === 'white' ? game.white : game.black)}
        </span>
        <span className="player-marks">
          {marks(side).map((m) => (
            <span key={m.glyph}>
              {m.n}
              <span className={`glyph c-${m.tone}`}>{m.glyph}</span>
            </span>
          ))}
        </span>
        <span className="player-acc">
          <span className="muted">accuracy</span>{' '}
          <strong>{acc(summary.accuracy[side])}</strong>
        </span>
      </div>
    );
    panelSummary = null;
    panelExtra = (
      <>
        {playerRow('white')}
        {playerRow('black')}
      </>
    );
    body = (
      <>
        {view.caption ? <p>{view.caption}</p> : null}
        <WinGraph
          pcts={pcts}
          ply={ply}
          onSelect={go}
          marks={summary.plies.filter(
            (p) =>
              p.cls === 'mistake' ||
              p.cls === 'blunder' ||
              p.cls === 'missedMate'
          )}
        />
        <table className="counts">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Move quality</span>
              </th>
              <th scope="col">{surname(game.white)}</th>
              <th scope="col">{surname(game.black)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Accuracy</th>
              {SIDES.map((side) => (
                <td key={side}>
                  <strong>{acc(summary.accuracy[side])}</strong>
                </td>
              ))}
            </tr>
            {(
              [
                ['Brilliant', ['brilliant'], '!!', 'brilliant'],
                ['Inaccuracies', ['inaccuracy'], '?!', 'inaccuracy'],
                ['Mistakes', ['mistake'], '?', 'mistake'],
                ['Blunders', ['blunder', 'missedMate'], '??', 'blunder'],
              ] satisfies [string, MoveClass[], string, string][]
            ).map(([label, classes, glyph, tone]) => (
              <tr key={label}>
                <th scope="row">
                  <span className={`glyph c-${tone}`}>{glyph}</span> {label}
                </th>
                {SIDES.map((side) => (
                  <td key={side}>
                    {classes.reduce((n, c) => n + summary.counts[side][c], 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {ENGINE_LABEL} · depth {analysis.depth}
        </p>
        {saveNote ? <p className="muted small">{saveNote}</p> : null}
        <div className="link-row">
          <ShareLink
            text={`${communityReview(view)?.full ?? `${displayName(game.white)} vs ${displayName(game.black)}`}, reviewed move by move. Spot the blunder?`}
          />
          {view.canReset ? (
            <Button
              variant="link"
              onClick={() => void rerun()}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset
                ? 'Tap again to replace this review'
                : 'Re-run review'}
            </Button>
          ) : null}
        </div>
        {resetError ? <Line tone="bad">{resetError}</Line> : null}
      </>
    );
  }

  return (
    <Screen
      top={top}
      evalBar={
        <EvalBar
          hidden={!analysis}
          share={score ? winPercent(score) / 100 : null}
          label={score ? scoreLabel(score) : ''}
          orientation={orientation}
        />
      }
      board={
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={uciKeys(game.moves[shown - 1])}
          interactive={false}
          shapes={shapes}
          highlights={highlights}
          label="Review board"
        />
      }
      strip={
        analysis ? (
          <MoveStrip
            startFen={game.startFen}
            moves={strip}
            index={ply}
            onSelect={go}
          />
        ) : null
      }
      summary={panelSummary}
      extra={panelExtra}
      // Short screens: the move verdict while stepping (accuracy is in the
      // sheet), the progress while it runs.
      compact={
        analysis && summary
          ? (top ?? (
              <span className="summary-text">
                {surname(game.white)}{' '}
                <strong>{acc(summary.accuracy.white)}</strong> ·{' '}
                {surname(game.black)}{' '}
                <strong>{acc(summary.accuracy.black)}</strong>
              </span>
            ))
          : panelSummary
      }
      details={body}
      detailsTitle="Game review"
      infoRows={2}
      nav={
        // Disabled until the review is done, so nothing moves when it lands.
        <fieldset className="nav-set" disabled={!analysis}>
          <NavButton
            icon="first"
            label="Start"
            onClick={() => go(0)}
            disabled={ply === 0}
          />
          <NavButton
            icon="prev"
            label="Previous move"
            onClick={() => go(ply - 1)}
            disabled={ply === 0}
          />
          <NavButton
            icon="next"
            label="Next move"
            onClick={() => go(ply + 1)}
            disabled={ply >= plies}
          />
          <NavButton
            icon="last"
            label="Last move"
            onClick={() => go(plies)}
            disabled={ply >= plies}
          />
          <NavButton
            icon="flip"
            label="Flip board"
            onClick={() =>
              setOrientation((o) => (o === 'white' ? 'black' : 'white'))
            }
          />
        </fieldset>
      }
    />
  );
}
