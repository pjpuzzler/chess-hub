import { showLoginPrompt } from '@devvit/web/client';
import { useEffect, useState } from 'react';
import type { LeaderboardKind, LeaderboardResponse } from '../../shared/api';
import { Button, Icon, Line, Spinner } from '../components/ui';
import { api, friendlyError } from '../lib/api';
import { formatNumber } from '../lib/format';

const KINDS: { id: LeaderboardKind; label: string }[] = [
  { id: 'streak', label: 'Streak' },
  { id: 'rating', label: 'Rating' },
  { id: 'solved', label: 'Solved' },
  { id: 'elo', label: 'Elo' },
];

const UNIT: Record<LeaderboardKind, (v: number) => string> = {
  streak: (v) => `${formatNumber(v)} ${v === 1 ? 'day' : 'days'}`,
  rating: (v) => String(v),
  solved: (v) => formatNumber(v),
  elo: (v) => `${formatNumber(v)} pts`,
};

type State =
  | { kind: LeaderboardKind; status: 'loading' }
  | { kind: LeaderboardKind; status: 'error' }
  | { kind: LeaderboardKind; status: 'ok'; data: LeaderboardResponse };

export function Leaderboard({
  username,
  canModerate,
  kinds,
}: {
  username: string | null;
  canModerate: boolean;
  kinds: LeaderboardKind[]; // boards this post shows, first is the default
}) {
  const initialKind = kinds[0] ?? 'streak';
  const [kind, setKind] = useState<LeaderboardKind>(initialKind);
  const [state, setState] = useState<State>({
    kind: initialKind,
    status: 'loading',
  });
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [modError, setModError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .leaderboard(kind)
      .then((data) => live && setState({ kind, status: 'ok', data }))
      .catch((err: unknown) => {
        console.error('leaderboard failed', err);
        if (live) setState({ kind, status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [kind, attempt]);

  const current: State =
    state.kind === kind ? state : { kind, status: 'loading' };
  const select = (k: LeaderboardKind) => {
    setKind(k);
    setConfirm(null);
    setState({ kind: k, status: 'loading' });
  };
  const reload = () => {
    setState({ kind, status: 'loading' });
    setAttempt((n) => n + 1);
  };

  const remove = async (name: string) => {
    if (confirm !== name) {
      setConfirm(name);
      return;
    }
    setConfirm(null);
    setModError(null);
    try {
      await api.leaderboardRemove(name);
      reload();
    } catch (err) {
      console.error('leaderboard remove failed', err);
      setModError(friendlyError(err));
    }
  };

  let body;
  if (current.status === 'loading') {
    body = (
      <div className="lb-state">
        <Spinner label="Loading leaderboard" />
      </div>
    );
  } else if (current.status === 'error') {
    body = (
      <p className="lb-state">
        Something went wrong.{' '}
        <Button variant="link" onClick={reload}>
          Try again
        </Button>
      </p>
    );
  } else {
    const { entries, me } = current.data;
    const meListed =
      me !== null && entries.some((e) => e.username === me.username);
    body =
      entries.length === 0 ? (
        <p className="lb-state muted">No one yet</p>
      ) : (
        <ol className="lb-list">
          {entries.map((e) => (
            <li
              key={e.username}
              className={`lb-row ${e.username === username ? 'me' : ''}`}
            >
              <span className="lb-rank">{e.rank}</span>
              <span className="lb-name">{e.username}</span>
              <span className="lb-value">{UNIT[kind](e.value)}</span>
              {editing && e.username !== username ? (
                <button
                  type="button"
                  className={`icon-btn lb-remove ${confirm === e.username ? 'armed' : ''}`}
                  aria-label={
                    confirm === e.username
                      ? `Confirm removing ${e.username} from all leaderboards`
                      : `Remove ${e.username} from leaderboards`
                  }
                  onClick={() => void remove(e.username)}
                  onBlur={() =>
                    setConfirm((c) => (c === e.username ? null : c))
                  }
                >
                  {confirm === e.username ? (
                    'Remove?'
                  ) : (
                    <Icon name="close" size={16} />
                  )}
                </button>
              ) : null}
            </li>
          ))}
          {me && !meListed ? (
            <li className="lb-row me detached">
              <span className="lb-rank">{me.rank}</span>
              <span className="lb-name">{me.username}</span>
              <span className="lb-value">{UNIT[kind](me.value)}</span>
            </li>
          ) : null}
        </ol>
      );
  }

  return (
    <section className="leaderboard" aria-label="Leaderboard">
      <nav className="lb-kinds" aria-label="Leaderboard type">
        {kinds.length > 1
          ? KINDS.filter((k) => kinds.includes(k.id)).map((k) => (
              <button
                key={k.id}
                type="button"
                className="lb-kind"
                aria-pressed={k.id === kind}
                onClick={() => select(k.id)}
              >
                {k.label}
              </button>
            ))
          : null}
        {canModerate ? (
          <button
            type="button"
            className="lb-kind lb-edit"
            aria-pressed={editing}
            onClick={() => {
              setEditing((v) => !v);
              setConfirm(null);
            }}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        ) : null}
      </nav>
      {body}
      {modError ? <Line tone="bad">{modError}</Line> : null}
      {username === null ? (
        <p className="muted">
          <Button variant="link" onClick={() => showLoginPrompt()}>
            Log in
          </Button>{' '}
          to get on the board.
        </p>
      ) : null}
    </section>
  );
}
