import { showLoginPrompt } from '@devvit/web/client';
import type { Color } from 'chessground/types';
import { useCallback, useMemo, useState } from 'react';
import type { EloReveal, EloView } from '../../shared/api';
import { parseGame } from '../../shared/chess/review';
import { Board } from '../components/Board';
import { MoveStrip } from '../components/MoveStrip';
import { Screen } from '../components/Screen';
import { Button, Line, NavButton, ShareButton } from '../components/ui';
import { api, friendlyError } from '../lib/api';
import { buildLine, uciKeys } from '../lib/chess';
import {
  beatPercent,
  clampGuess,
  ELO_MAX,
  ELO_MIN,
  ELO_STEP,
} from '../lib/elo';
import { plural, timeControlLabel } from '../lib/format';
import { useMoveKeys } from '../lib/useMoveKeys';

type Props = {
  view: EloView;
  loggedIn: boolean;
  active: boolean;
  ply: number;
  onPly: (ply: number) => void;
  canPost: boolean; // show the "stump them" nudge
  onPost: () => void;
  onGuessed: () => void;
};

export function EloTab(props: Props) {
  const game = useMemo(
    () => parseGame(props.view.game.pgn),
    [props.view.game.pgn]
  );
  if ('error' in game)
    return <p className="line tone-bad pad">This game couldn’t be read.</p>;
  return <Elo {...props} startFen={game.startFen} moves={game.moves} />;
}

function Elo({
  view,
  loggedIn,
  active,
  ply,
  onPly,
  canPost,
  onPost,
  onGuessed,
  startFen,
  moves,
}: Props & { startFen: string; moves: string[] }) {
  const line = useMemo(() => buildLine(startFen, moves), [startFen, moves]);
  const plies = line.length;
  const [orientation, setOrientation] = useState<Color>('white');
  const [guess, setGuess] = useState(1500);
  const [myGuess, setMyGuess] = useState<number | null>(view.myGuess);
  const [myScore, setMyScore] = useState<number | null>(view.myScore);
  const [reveal, setReveal] = useState<EloReveal | null>(view.reveal);
  const [percentile, setPercentile] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(
    (i: number) => onPly(Math.max(0, Math.min(plies, i))),
    [onPly, plies]
  );
  useMoveKeys(active, ply, plies, go);

  const lockIn = async () => {
    if (!loggedIn) {
      showLoginPrompt();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.eloGuess({ guess: clampGuess(guess) });
      setMyGuess(res.myGuess);
      setMyScore(res.myScore);
      setReveal(res.reveal);
      setPercentile(res.percentile);
      onGuessed();
    } catch (err) {
      console.error('elo guess failed', err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const fen = ply === 0 ? startFen : (line[ply - 1]?.fen ?? startFen);
  const tc = timeControlLabel(view.game.timeControl);

  const byline = (
    <>
      {view.caption ? <p>{view.caption}</p> : null}
      {view.author || view.source === 'selfReported' ? (
        <p className="muted small">
          {view.author ? `Posted by u/${view.author}` : ''}
          {view.author && view.source === 'selfReported' ? ' · ' : ''}
          {view.source === 'selfReported' ? 'Ratings self-reported' : ''}
        </p>
      ) : null}
    </>
  );

  let top;
  let summary;
  let compact;
  let extra;
  let details;
  if (reveal && myGuess !== null) {
    const off = Math.abs(myGuess - reveal.average);
    const beat =
      percentile ?? beatPercent(reveal.histogram, reveal.average, myGuess);
    // Green within 100, amber within 300, red beyond.
    const closeness = off <= 100 ? 'near' : off <= 300 ? 'mid' : 'far';
    // The whole result in one place: the status line and the rows under
    // the board.
    top = (
      <div className="top-row">
        <p className="line elo-big">
          You <strong>{myGuess}</strong> · Actual{' '}
          <strong>{reveal.average}</strong>
        </p>
        <ShareButton
          text={
            off <= 100
              ? `I guessed within ${off} Elo. Your turn.`
              : 'This Guess the Elo game fooled me. Can you do better?'
          }
        />
      </div>
    );
    summary = (
      <span>
        <span className={`off-${closeness}`}>Off by {off}</span> ·{' '}
        <strong>{myScore ?? '–'}</strong> / 100
      </span>
    );
    extra = (
      <div className="info-row muted">
        White {reveal.white} · Black {reveal.black} · {tc}
      </div>
    );
    compact = (
      <span className="summary-text grow">
        You <strong className={`off-${closeness}`}>{myGuess}</strong> · Actual{' '}
        <strong>{reveal.average}</strong> · <strong>{myScore ?? '–'}</strong> /
        100
      </span>
    );
    details = (
      <>
        <p>Better than {beat}% of guessers</p>
        <Histogram reveal={reveal} guess={myGuess} />
        <p className="muted">
          {plural(reveal.totalGuesses, 'guess', 'guesses')} so far
        </p>
        {byline}
        {canPost ? (
          <p>
            <Button variant="link" onClick={onPost}>
              Post your game
            </Button>
          </p>
        ) : null}
      </>
    );
  } else {
    top = (
      <div className="top-row">
        <Line>Guess the average rating</Line>
        <span className="muted small">
          {view.source === 'selfReported' ? 'Self-reported' : tc}
        </span>
      </div>
    );
    summary = (
      <div className="guess">
        <output className="guess-value" aria-live="polite">
          {guess}
        </output>
        <input
          className="guess-slider"
          type="range"
          min={ELO_MIN}
          max={ELO_MAX}
          step={ELO_STEP}
          value={guess}
          aria-label="Your guess"
          onChange={(e) => setGuess(clampGuess(Number(e.target.value)))}
        />
        <Button variant="primary" onClick={() => void lockIn()} disabled={busy}>
          {busy ? 'Locking…' : loggedIn ? 'Lock in' : 'Log in'}
        </Button>
      </div>
    );
    // Where the game is from, the same row for curated and member games;
    // a member's caption follows their name, kept to one line.
    extra = (
      <div className="info-row muted">
        {error ? (
          <span className="tone-bad">{error}</span>
        ) : view.author ? (
          <span className="summary-text">
            u/{view.author}
            {view.caption ? (
              <span className="caption">: {view.caption}</span>
            ) : null}
          </span>
        ) : (
          'A rated Lichess game'
        )}
      </div>
    );
    details = null;
  }

  return (
    <Screen
      top={top}
      board={
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={uciKeys(line[ply - 1]?.uci)}
          interactive={false}
          label="Game board"
        />
      }
      strip={
        <MoveStrip startFen={startFen} moves={line} index={ply} onSelect={go} />
      }
      summary={summary}
      extra={extra}
      compact={compact ?? summary}
      details={details}
      detailsTitle={reveal ? 'Guesses' : 'About this game'}
      infoRows={2}
      nav={
        <>
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
        </>
      }
    />
  );
}

// Community guesses in 100-point buckets, with the answer and your guess.
function Histogram({ reveal, guess }: { reveal: EloReveal; guess: number }) {
  const W = 300;
  const H = 64;
  const lo = ELO_MIN;
  const hi = ELO_MAX;
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  const max = Math.max(1, ...reveal.histogram.map((b) => b.count));
  return (
    <figure className="histogram">
      <svg
        viewBox={`0 0 ${W} ${H + 14}`}
        role="img"
        aria-label={`Guesses; answer ${reveal.average}, yours ${guess}`}
      >
        {reveal.histogram.map((b) => (
          <rect
            key={b.bucket}
            className="hist-bar"
            x={x(b.bucket) + 0.5}
            width={Math.max(1, x(b.bucket + 100) - x(b.bucket) - 1)}
            y={H - (b.count / max) * H}
            height={(b.count / max) * H}
          />
        ))}
        <line
          className="hist-answer"
          x1={x(reveal.average)}
          x2={x(reveal.average)}
          y1={0}
          y2={H}
        />
        <line
          className="hist-guess"
          x1={x(guess)}
          x2={x(guess)}
          y1={0}
          y2={H}
        />
        <text className="hist-label" x={0} y={H + 12}>
          {lo}
        </text>
        <text className="hist-label" x={W} y={H + 12} textAnchor="end">
          {hi}
        </text>
      </svg>
      <figcaption className="muted small">
        <span className="key key-answer" /> answer{' '}
        <span className="key key-guess" /> you
      </figcaption>
    </figure>
  );
}
