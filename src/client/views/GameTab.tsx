import { navigateToPost, showLoginPrompt } from '@devvit/web/client';
import type { DrawShape } from 'chessground/draw';
import type { Color } from 'chessground/types';
import { useCallback, useMemo, useState } from 'react';
import type { GameView, PollResult } from '../../shared/api';
import { Board } from '../components/Board';
import { MoveStrip } from '../components/MoveStrip';
import { Screen } from '../components/Screen';
import { VoteControls, VoteResults } from '../components/Vote';
import { Button, Line, NavButton, ShareButton } from '../components/ui';
import { holyHell } from '../lib/anarchy';
import { api, ApiError, friendlyError } from '../lib/api';
import {
  buildLine,
  gameEnd,
  isEnPassantAvailable,
  playMove,
  START_FEN,
  uciKeys,
  type LineMove,
} from '../lib/chess';
import { plural, sharePercents } from '../lib/format';
import { useMoveKeys } from '../lib/useMoveKeys';
import { voteShapes } from '../lib/vote';

type Props = {
  view: GameView;
  orientation: Color;
  active: boolean;
  loggedIn: boolean;
  anarchy: boolean;
};

const isPostId = (id: string): id is `t3_${string}` => id.startsWith('t3_');

// Community game post: vote on the next move while open (no engine), then
// the winning move and a link on to the next post.
export function GameTab({
  view,
  orientation,
  active,
  loggedIn,
  anarchy,
}: Props) {
  const [results, setResults] = useState<PollResult[] | null>(view.results);
  const [myVote, setMyVote] = useState<string | null>(view.myVote);
  const [total, setTotal] = useState(view.totalVotes);
  const [pick, setPick] = useState<LineMove | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const line = useMemo(() => buildLine(START_FEN, view.moves), [view.moves]);
  const plies = line.length;
  // Stepping back through the game; null = the position being voted on.
  const [ply, setPly] = useState<number | null>(null);
  const shownPly = ply ?? plies;
  const browsing = shownPly < plies;
  const go = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(plies, i));
      setPly(next >= plies ? null : next);
    },
    [plies]
  );
  useMoveKeys(active && pick === null, shownPly, plies, go);

  const open = view.status === 'open';
  const canVote = open && myVote === null;
  const revealed = results !== null && (myVote !== null || !open);
  const side = view.turn === 'white' ? 'White' : 'Black';

  const refresh = useCallback(async () => {
    try {
      const init = await api.init();
      if (init.post.kind !== 'game') return;
      setResults(init.post.results);
      setMyVote(init.post.myVote);
      setTotal(init.post.totalVotes);
    } catch (err) {
      console.error('game refresh failed', err);
    }
  }, []);

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
      const res = await api.gameVote({ move: pick.uci });
      setResults(res.results);
      setMyVote(res.myVote);
      setTotal(res.totalVotes);
      setPick(null);
    } catch (err) {
      console.error('game vote failed', err);
      setError(friendlyError(err));
      // Already voted elsewhere, or voting just closed.
      if (err instanceof ApiError && err.status === 409) {
        setPick(null);
        await refresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pcts = useMemo(
    () => sharePercents(results?.map((r) => r.votes) ?? []),
    [results]
  );
  const shapes = useMemo<DrawShape[]>(() => {
    if (browsing || pick) return [];
    if (view.winningMove && !results?.length) {
      const keys = uciKeys(view.winningMove.move);
      return keys ? [{ orig: keys[0], dest: keys[1], brush: 'green' }] : [];
    }
    return revealed && results ? voteShapes(results, pcts) : [];
  }, [browsing, pick, view.winningMove, revealed, results, pcts]);

  const votes = plural(total, 'vote');
  const next = view.nextPostId;
  // The winning move ended the game: the next post is the result.
  const endedByMove = view.winningMove
    ? gameEnd(playMove(view.fen, view.winningMove.move)?.fen ?? view.fen) !==
      null
    : false;
  const nextButton =
    view.status === 'closed' && next && isPostId(next) ? (
      <Button variant="primary" onClick={() => navigateToPost(next)}>
        {endedByMove ? 'See the result' : 'Next vote'}
      </Button>
    ) : null;

  const resultsLine = (count: number, className = 'summary-text') =>
    results && results.length ? (
      <VoteResults
        results={results}
        pcts={pcts}
        myVote={myVote}
        count={count}
        className={className}
      />
    ) : (
      <span className="muted summary-text grow">No votes</span>
    );

  let top: string;
  let summary;
  let extra = null;
  let compact;
  if (view.status === 'ended') {
    top = 'The moderators ended this game';
    summary = resultsLine(3);
    extra = <div className="info-row muted">{votes} · voting closed</div>;
    compact = <span className="muted">The moderators ended this game</span>;
  } else if (view.status === 'closed') {
    const san = view.winningMove?.san;
    top = san ? `${side} played ${san} · ${votes}` : votes;
    summary = resultsLine(3);
    extra = (
      <div className="info-row">
        <span className="muted grow">
          {next ? 'Voting is on the next post' : 'Next post coming soon'}
        </span>
        {nextButton}
      </div>
    );
    compact = (
      <>
        {san ? (
          <span className="summary-text grow">
            {side} played <strong>{san}</strong>
          </span>
        ) : (
          resultsLine(2, 'summary-text grow')
        )}
        {nextButton}
      </>
    );
  } else if (revealed && results) {
    top = `${votes} · the top move is played next`;
    summary = resultsLine(3);
    extra = (
      <div className="info-row muted">
        {error ? (
          <span className="tone-bad">{error}</span>
        ) : (
          'Engine opens once voting closes'
        )}
      </div>
    );
    compact = resultsLine(2, 'summary-text grow');
  } else if (canVote) {
    top = pick ? 'Tap Vote to confirm' : `Play ${side}’s move to vote`;
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
              `${votes} so far`
            )}
          </span>
        }
      />
    );
    extra = <div className="info-row muted">Results show once you vote</div>;
    compact =
      pick || typing ? (
        summary
      ) : (
        <Line tone="muted">
          Play {side}’s move to vote · {votes}
        </Line>
      );
  } else {
    top = votes;
    summary = <span className="muted">Results aren’t in yet</span>;
    compact = summary;
  }

  const shownMove = browsing ? line[shownPly - 1] : undefined;
  const boardFen = pick
    ? pick.fen
    : browsing
      ? (shownMove?.fen ?? START_FEN)
      : view.fen;
  const lastMove = pick
    ? uciKeys(pick.uci)
    : browsing
      ? uciKeys(shownMove?.uci)
      : uciKeys(view.lastMove);

  return (
    <Screen
      top={
        <div className="top-row">
          <Line tone="muted">{top}</Line>
          {myVote ? (
            <ShareButton text="I voted on our community game’s next move. What would you play?" />
          ) : null}
        </div>
      }
      board={
        <Board
          fen={boardFen}
          orientation={
            flipped
              ? orientation === 'white'
                ? 'black'
                : 'white'
              : orientation
          }
          lastMove={lastMove}
          interactive={canVote && !submitting && !pick && !browsing}
          shapes={shapes}
          onMove={onMove}
          label="Community game board"
        />
      }
      strip={
        <MoveStrip
          startFen={START_FEN}
          moves={line}
          index={shownPly}
          onSelect={(i) => {
            if (!pick) go(i);
          }}
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
              onClick={() => {
                setPly(null);
                setTyping((t) => !t);
              }}
              disabled={pick !== null || submitting}
            />
          ) : null}
          <NavButton
            icon="prev"
            label="Previous move"
            onClick={() => go(shownPly - 1)}
            disabled={shownPly === 0 || pick !== null}
          />
          <NavButton
            icon="next"
            label="Next move"
            onClick={() => go(shownPly + 1)}
            disabled={!browsing}
          />
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
