import { showLoginPrompt } from '@devvit/web/client';
import type { DrawShape } from 'chessground/draw';
import type { Color } from 'chessground/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineScore, PollResult, PollView } from '../../shared/api';
import { Board } from '../components/Board';
import { Screen } from '../components/Screen';
import { VoteControls, VoteResults } from '../components/Vote';
import {
  Button,
  Line,
  LoginButton,
  NavButton,
  ShareButton,
} from '../components/ui';
import { BatchAnalyzer } from '../engine/batch';
import { formatScore } from '../engine/uci';
import { holyHell } from '../lib/anarchy';
import { api, ApiError, friendlyError } from '../lib/api';
import {
  isEnPassantAvailable,
  playMove,
  uciKeys,
  type LineMove,
} from '../lib/chess';
import { duration, plural, sharePercents } from '../lib/format';
import { voteShapes } from '../lib/vote';

type Props = {
  view: PollView;
  orientation: Color;
  loggedIn: boolean;
  anarchy: boolean;
  canAsk: boolean; // show the "Post a position" nudge
  onAsk: () => void;
  onReveal: () => void;
};

type Reveal =
  | { status: 'idle' | 'running' | 'error' }
  | {
      status: 'done';
      best: string | null;
      bestScore: EngineScore | null;
      evals: Map<string, EngineScore>;
    };

// Eval text (White's view), as in the engine line.
const scoreText = (s: EngineScore | null | undefined) =>
  !s
    ? ''
    : 'mate' in s
      ? formatScore({ mate: s.mate })
      : formatScore({ cp: s.cp });

export function PollTab({
  view,
  orientation,
  loggedIn,
  anarchy,
  canAsk,
  onAsk,
  onReveal,
}: Props) {
  const [results, setResults] = useState<PollResult[] | null>(view.results);
  const [myVote, setMyVote] = useState<string | null>(view.myVote);
  const [total, setTotal] = useState(view.totalVotes);
  const [pick, setPick] = useState<LineMove | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reveal, setReveal] = useState<Reveal>({ status: 'idle' });
  const [typing, setTyping] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const analyzer = useRef<BatchAnalyzer | null>(null);
  useEffect(() => () => analyzer.current?.cancel(), []);

  useEffect(() => {
    if (view.closesAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    // Also tick exactly at closing time so results appear right away.
    const left = view.closesAt - Date.now();
    const close =
      left > 0 && left < 86_400_000
        ? setTimeout(() => setNow(Date.now()), left + 50)
        : undefined;
    return () => {
      clearInterval(id);
      clearTimeout(close);
    };
  }, [view.closesAt]);

  const closed = view.closesAt !== null && view.closesAt <= now;
  const revealed = results !== null && (myVote !== null || closed);
  const canVote = !myVote && !closed;

  useEffect(() => {
    if (revealed) onReveal();
  }, [revealed, onReveal]);

  // Picks up results the server now shows (poll closed, or already voted).
  const refresh = useCallback(async () => {
    try {
      const init = await api.init();
      if (init.post.kind !== 'poll') return;
      setResults(init.post.results);
      setMyVote(init.post.myVote);
      setTotal(init.post.totalVotes);
    } catch (err) {
      console.error('poll refresh failed', err);
    }
  }, []);

  useEffect(() => {
    if (!closed || results !== null) return;
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [closed, results, refresh]);

  const onMove = (uci: string) => {
    const move = playMove(view.fen, uci);
    if (!move) return;
    if (move.enPassant && anarchy) holyHell();
    setPick(move);
    setError(null);
  };

  const vote = async () => {
    if (!pick) return;
    if (!loggedIn) {
      showLoginPrompt();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.pollVote({ move: pick.uci });
      setResults(res.results);
      setMyVote(res.myVote);
      setTotal(res.totalVotes);
      setPick(null);
    } catch (err) {
      console.error('vote failed', err);
      setError(friendlyError(err));
      // Already voted (another device) or the poll just closed: show results.
      if (err instanceof ApiError && err.status === 409) {
        setPick(null);
        await refresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Was the crowd right? Evaluate the position and every voted move.
  const askEngine = async () => {
    if (!results) return;
    const a = new BatchAnalyzer();
    analyzer.current = a;
    setReveal({ status: 'running' });
    const after = results.map(
      (r) => playMove(view.fen, r.move)?.fen ?? view.fen
    );
    try {
      const positions = await a.positions([view.fen, ...after]);
      const evals = new Map<string, EngineScore>();
      results.forEach((r, i) => {
        const p = positions[i + 1];
        if (p) evals.set(r.move, p.score);
      });
      const root = positions[0];
      setReveal({
        status: 'done',
        best: root?.best ?? null,
        bestScore: root?.score ?? null,
        evals,
      });
    } catch (err) {
      if (analyzer.current !== a) return;
      console.error('reveal failed', err);
      setReveal({ status: 'error' });
    } finally {
      if (analyzer.current === a) analyzer.current = null;
    }
  };

  const pcts = useMemo(
    () => sharePercents(results?.map((r) => r.votes) ?? []),
    [results]
  );

  const shapes = useMemo<DrawShape[]>(
    () => (revealed && results ? voteShapes(results, pcts) : []),
    [revealed, results, pcts]
  );

  let verdict = '';
  let crowdRight = false;
  if (reveal.status === 'done' && results && results.length) {
    const top = results[0];
    const bestSan = reveal.best
      ? (results.find((r) => r.move === reveal.best)?.san ??
        playMove(view.fen, reveal.best)?.san ??
        reveal.best)
      : null;
    crowdRight = top !== undefined && top.move === reveal.best;
    if (!bestSan) verdict = 'No legal moves here';
    else if (crowdRight) verdict = `Stockfish agrees: ${bestSan}`;
    else verdict = `Stockfish prefers ${bestSan}`;
  }

  const meta = `${plural(total, 'vote')}${
    closed
      ? ' · closed'
      : view.closesAt !== null
        ? ` · closes in ${duration(view.closesAt - now)}`
        : ''
  }`;

  let summary;
  let extra = null;
  let youOutside: string | null = null;
  if (revealed && results) {
    // Everything inline: the top moves (yours marked), then Stockfish.
    const mine = results.find((r) => r.move === myVote);
    summary = (
      <VoteResults results={results} pcts={pcts} myVote={myVote} count={3} />
    );
    const bestEval =
      reveal.status === 'done' && reveal.best
        ? reveal.evals.get(reveal.best)
        : undefined;
    extra = (
      <div className="info-row">
        <span className="grow summary-text">
          {reveal.status === 'done' ? (
            <span className={crowdRight ? 'tone-good' : undefined}>
              {verdict}
              {bestEval ? (
                <span className="muted"> · {scoreText(bestEval)}</span>
              ) : null}
            </span>
          ) : reveal.status === 'error' ? (
            <span className="tone-bad">Engine unavailable on this device</span>
          ) : (
            <Button
              variant="primary"
              onClick={() => void askEngine()}
              disabled={reveal.status === 'running'}
            >
              {reveal.status === 'running' ? 'Thinking…' : 'Ask Stockfish'}
            </Button>
          )}
        </span>
        {error ? (
          <span className="tone-bad">{error}</span>
        ) : !loggedIn && closed ? (
          <LoginButton>Log in to vote</LoginButton>
        ) : canAsk ? (
          <Button variant="link" onClick={onAsk}>
            Post a position
          </Button>
        ) : null}
      </div>
    );
    if (mine && !results.slice(0, 3).includes(mine))
      // Your vote isn't in the top three: say it in the status line.
      youOutside = mine.san;
  } else if (canVote) {
    summary = (
      <VoteControls
        fen={view.fen}
        pick={pick}
        typing={typing}
        submitting={submitting}
        loggedIn={loggedIn}
        onVote={() => void vote()}
        onUndo={() => setPick(null)}
        onMove={onMove}
        onCloseTyping={() => setTyping(false)}
        idle={
          <span className="muted summary-text">
            {error ? (
              <span className="tone-bad">{error}</span>
            ) : anarchy && isEnPassantAvailable(view.fen) ? (
              'Google en passant'
            ) : (
              meta
            )}
          </span>
        }
      />
    );
  } else {
    summary = <span className="muted">Results aren’t in yet</span>;
  }
  if (canVote)
    extra = <div className="info-row muted">Results show once you vote</div>;
  // Short screens: one row under the board.
  let compact = summary;
  if (revealed && results) {
    const best = reveal.status === 'done' ? reveal.best : null;
    const bestSan = best
      ? (results.find((r) => r.move === best)?.san ??
        playMove(view.fen, best)?.san ??
        null)
      : null;
    compact = (
      <>
        <VoteResults
          results={results}
          pcts={pcts}
          count={2}
          className="summary-text grow"
        />
        {reveal.status === 'done' ? (
          bestSan ? (
            <span className={crowdRight ? 'tone-good' : undefined}>
              Stockfish: {bestSan}
            </span>
          ) : null
        ) : reveal.status === 'error' ? null : (
          <Button
            variant="primary"
            onClick={() => void askEngine()}
            disabled={reveal.status === 'running'}
          >
            {reveal.status === 'running' ? 'Thinking…' : 'Ask Stockfish'}
          </Button>
        )}
      </>
    );
  } else if (canVote && !pick && !typing) {
    compact = <Line tone="muted">Play your move to vote · {meta}</Line>;
  }

  return (
    <Screen
      top={
        <div className="top-row">
          <Line tone="muted">
            {canVote
              ? pick
                ? 'Tap Vote to confirm'
                : 'Play your move to vote'
              : youOutside
                ? `${meta} · you ${youOutside}`
                : meta}
          </Line>
          {myVote ? (
            <ShareButton text="I voted on this position. What would you play?" />
          ) : null}
        </div>
      }
      board={
        <Board
          fen={pick ? pick.fen : view.fen}
          orientation={
            flipped
              ? orientation === 'white'
                ? 'black'
                : 'white'
              : orientation
          }
          lastMove={pick ? uciKeys(pick.uci) : uciKeys(view.lastMove)}
          interactive={canVote && !submitting && !pick}
          shapes={shapes}
          onMove={onMove}
          label="Poll board"
        />
      }
      summary={summary}
      compact={compact}
      extra={extra}
      infoRows={2}
      nav={
        <>
          {canVote ? (
            <NavButton
              icon="keyboard"
              label="Type"
              showLabel
              aria-pressed={typing}
              onClick={() => setTyping((t) => !t)}
              disabled={pick !== null || submitting}
            />
          ) : null}
          <NavButton
            icon="flip"
            label="Flip board"
            onClick={() => setFlipped((f) => !f)}
          />
        </>
      }
    />
  );
}
