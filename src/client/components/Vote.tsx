// Shared pieces of the move votes (polls and the community game).
import type { ReactNode } from 'react';
import type { PollResult } from '../../shared/api';
import type { LineMove } from '../lib/chess';
import { MoveInput } from './MoveInput';
import { Button } from './ui';

// "Rxd7 64% · Bxf6 21% · ...", the viewer's own vote marked: as many whole
// moves as fit on the row (the rest wrap onto a hidden second line).
const MAX_SHOWN = 6;

export function VoteResults({
  results,
  pcts,
  myVote = null,
  className = 'summary-text',
}: {
  results: PollResult[];
  pcts: number[];
  myVote?: string | null;
  className?: string;
}) {
  return (
    <span className={`${className} vote-results`}>
      {results.slice(0, MAX_SHOWN).map((r, i) => (
        <span key={r.move}>
          <strong>{r.san}</strong> {pcts[i] ?? 0}%
          {r.move === myVote ? <span className="muted"> (you)</span> : null}
        </span>
      ))}
    </span>
  );
}

// The vote row before voting: Vote/Undo once a move is picked, the typing
// box, or `idle` (status text).
export function VoteControls({
  fen,
  pick,
  typing,
  submitting,
  loggedIn,
  idle,
  onVote,
  onUndo,
  onMove,
  onCloseTyping,
}: {
  fen: string;
  pick: LineMove | null;
  typing: boolean;
  submitting: boolean;
  loggedIn: boolean;
  idle: ReactNode;
  onVote: () => void;
  onUndo: () => void;
  onMove: (uci: string) => void;
  onCloseTyping: () => void;
}) {
  if (pick)
    return (
      <>
        <Button
          variant="primary"
          onClick={onVote}
          disabled={submitting}
          className="grow"
        >
          {submitting
            ? 'Voting…'
            : loggedIn
              ? `Vote ${pick.san}`
              : 'Log in to vote'}
        </Button>
        <Button onClick={onUndo} disabled={submitting}>
          Undo
        </Button>
      </>
    );
  if (typing)
    return (
      <MoveInput
        fen={fen}
        disabled={submitting}
        onMove={(u) => {
          onCloseTyping();
          onMove(u);
        }}
        onClose={onCloseTyping}
      />
    );
  return <>{idle}</>;
}
