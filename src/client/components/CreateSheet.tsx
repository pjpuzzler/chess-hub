import { context, navigateTo, showToast } from '@devvit/web/client';
import { validateFen } from 'chess.js';
import { useMemo, useState, type FormEvent } from 'react';
import type { CreateOptions } from '../../shared/api';
import { parseGame } from '../../shared/chess/review';
import { api, friendlyError } from '../lib/api';
import { buildLine, turnOf, uciKeys } from '../lib/chess';
import { editorFen, positionProblem, type Side } from '../lib/position';
import { Board } from './Board';
import { PositionEditor } from './PositionEditor';
import { MoveStrip } from './MoveStrip';
import { Sheet } from './Sheet';
import { Button, NavButton } from './ui';

export type CreateKind = 'review' | 'elo' | 'poll';

const CHOICES: { id: CreateKind; label: string; hint: string }[] = [
  {
    id: 'review',
    label: 'Review my game',
    hint: 'Accuracy and mistakes, move by move',
  },
  { id: 'elo', label: 'Guess my Elo', hint: 'Can the sub guess your rating?' },
  {
    id: 'poll',
    label: 'What’s the move?',
    hint: 'Ask the sub about a position',
  },
];

const LICHESS_RE = /lichess\.org\//i;

// The "+" sheet: one short form per kind of member post.
export function CreateSheet({
  options,
  initial,
  onClose,
  onPollPosition,
}: {
  options: CreateOptions;
  initial: CreateKind | null;
  onClose: () => void;
  // From Analyze: a poll of the board's current position.
  onPollPosition?: (() => void) | undefined;
}) {
  const [kind, setKind] = useState<CreateKind | null>(initial);
  const sub = context.subredditName
    ? `r/${context.subredditName}`
    : 'this subreddit';
  const choices = CHOICES.filter((c) => options[c.id]);
  const title = kind
    ? (CHOICES.find((c) => c.id === kind)?.label ?? '')
    : `Post to ${sub}`;

  return (
    <Sheet title={title} onClose={onClose}>
      {kind === null ? (
        <ul className="choices">
          {onPollPosition ? (
            <li>
              <button type="button" className="choice" onClick={onPollPosition}>
                <span className="choice-label">Poll this position</span>
                <span className="muted small">
                  Ask the sub what to play on the board you’re analysing
                </span>
              </button>
            </li>
          ) : null}
          {choices.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="choice"
                onClick={() => setKind(c.id)}
              >
                <span className="choice-label">{c.label}</span>
                <span className="muted small">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : kind === 'poll' ? (
        <PollForm
          sub={sub}
          remaining={options.remainingToday}
          onDone={onClose}
        />
      ) : (
        <GameForm
          kind={kind}
          sub={sub}
          remaining={options.remainingToday}
          onDone={onClose}
        />
      )}
    </Sheet>
  );
}

/** "Posts to r/x as you" (user actions must say so), with posts left today. */
export function Footer({ sub, remaining }: { sub: string; remaining: number }) {
  return (
    <p className="muted small">
      Posts to {sub} as you
      {remaining <= 2
        ? ` · ${remaining} ${remaining === 1 ? 'post' : 'posts'} left today`
        : ''}
    </p>
  );
}

function GameForm({
  kind,
  sub,
  remaining,
  onDone,
}: {
  kind: 'review' | 'elo';
  sub: string;
  remaining: number;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pgnOrUrl = text.trim();
    if (!pgnOrUrl || busy) return;
    if (!LICHESS_RE.test(pgnOrUrl) && 'error' in parseGame(pgnOrUrl)) {
      setError('That doesn’t look like a game link or PGN');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { pgnOrUrl, caption: caption.trim() };
      const res =
        kind === 'review'
          ? await api.reviewCreate(body)
          : await api.eloCreate(body);
      showToast('Posted');
      onDone();
      navigateTo(res.url);
    } catch (err) {
      console.error('create failed', err);
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form className="sheet-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Paste a game link or PGN</span>
        <textarea
          value={text}
          rows={3}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>
      <p className="muted small">
        {kind === 'elo'
          ? 'The game must include both players’ ratings. Names stay hidden.'
          : 'On Chess.com: Share › PGN › Copy'}
      </p>
      <label className="field">
        <span>Caption (optional)</span>
        <input
          type="text"
          value={caption}
          maxLength={200}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>
      {error ? <p className="line tone-bad">{error}</p> : null}
      <Button
        variant="primary"
        type="submit"
        disabled={busy || !text.trim() || remaining <= 0}
      >
        {busy ? 'Posting…' : 'Post'}
      </Button>
      <Footer sub={sub} remaining={remaining} />
    </form>
  );
}

type Source = { startFen: string; moves: string[] } | { error: string } | null;

function readSource(text: string): Source {
  const t = text.trim();
  if (!t) return null;
  if (validateFen(t).ok) return { startFen: t, moves: [] };
  const game = parseGame(t);
  return 'error' in game
    ? { error: 'That doesn’t look like a game link, PGN or FEN' }
    : game;
}

const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// "What's the move?": set up the position on a board (default), or paste a
// game and pick the moment.
function PollForm({
  sub,
  remaining,
  onDone,
}: {
  sub: string;
  remaining: number;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'edit' | 'paste'>('edit');
  const [placement, setPlacement] = useState(START_PLACEMENT);
  const [side, setSide] = useState<Side>('white');
  const [editorKey, setEditorKey] = useState(0);
  const [text, setText] = useState('');
  const [fetched, setFetched] = useState<string | null>(null); // PGN loaded from a link
  const [plyChoice, setPly] = useState<number | null>(null); // null = end of the game
  const [prompt, setPrompt] = useState<string | null>(null); // null = default
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLink = LICHESS_RE.test(text.trim());
  const source = useMemo(
    () => readSource(fetched ?? (isLink ? '' : text)),
    [text, fetched, isLink]
  );
  const game =
    mode === 'paste' && source && !('error' in source) ? source : null;
  const line = useMemo(
    () => (game ? buildLine(game.startFen, game.moves) : []),
    [game]
  );
  const ply = plyChoice ?? line.length;
  const pasteFen = game
    ? ply === 0
      ? game.startFen
      : (line[ply - 1]?.fen ?? game.startFen)
    : null;

  const fen = mode === 'edit' ? editorFen(placement, side) : pasteFen;
  const problem = mode === 'edit' ? positionProblem(placement, side) : null;
  const sideName = fen && turnOf(fen) === 'white' ? 'White' : 'Black';
  const shownPrompt = prompt ?? `${sideName} to play`;

  const loadLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.gameFetch(text.trim());
      setFetched(res.pgn);
      setPly(null);
    } catch (err) {
      console.error('game fetch failed', err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const editThis = () => {
    if (!pasteFen) return;
    const [place, turn] = pasteFen.split(' ');
    setPlacement(place ?? START_PLACEMENT);
    setSide(turn === 'b' ? 'black' : 'white');
    setEditorKey((k) => k + 1);
    setMode('edit');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fen || busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.pollCreate({
        fen,
        prompt: shownPrompt.trim() || `${sideName} to play`,
        closeHours: 24,
        lastMove: mode === 'paste' ? (line[ply - 1]?.uci ?? null) : null,
      });
      showToast('Posted');
      onDone();
      navigateTo(res.url);
    } catch (err) {
      console.error('poll create failed', err);
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form className="sheet-form" onSubmit={(e) => void submit(e)}>
      {mode === 'edit' ? (
        <>
          <PositionEditor
            key={editorKey}
            placement={placement}
            side={side}
            onChange={(p, s) => {
              setPlacement(p);
              setSide(s);
            }}
          />
          {problem ? <p className="line tone-bad">{problem}</p> : null}
          <Button variant="link" onClick={() => setMode('paste')}>
            Paste a game instead
          </Button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Paste a game link, PGN or FEN</span>
            <textarea
              value={text}
              rows={game ? 2 : 3}
              onChange={(e) => {
                setText(e.target.value);
                setFetched(null);
                setPly(null);
                setError(null);
              }}
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          {isLink && !fetched ? (
            <Button onClick={() => void loadLink()} disabled={busy}>
              {busy ? 'Loading…' : 'Load game'}
            </Button>
          ) : null}
          {game && pasteFen ? (
            <>
              <div className="sheet-board">
                <Board
                  fen={pasteFen}
                  orientation={turnOf(pasteFen)}
                  lastMove={uciKeys(line[ply - 1]?.uci)}
                  interactive={false}
                  label="Poll position"
                />
              </div>
              {line.length ? (
                <>
                  <MoveStrip
                    startFen={game.startFen}
                    moves={line}
                    index={ply}
                    onSelect={setPly}
                  />
                  <div className="sheet-nav">
                    <NavButton
                      icon="prev"
                      label="Previous move"
                      onClick={() => setPly(Math.max(0, ply - 1))}
                      disabled={ply === 0}
                    />
                    <span className="muted small">Pick the moment</span>
                    <NavButton
                      icon="next"
                      label="Next move"
                      onClick={() => setPly(Math.min(line.length, ply + 1))}
                      disabled={ply >= line.length}
                    />
                  </div>
                </>
              ) : null}
              <Button variant="link" onClick={editThis}>
                Edit this position
              </Button>
            </>
          ) : source && 'error' in source ? (
            <p className="line tone-bad">{source.error}</p>
          ) : null}
          <Button variant="link" onClick={() => setMode('edit')}>
            Set up a position instead
          </Button>
        </>
      )}
      {fen ? (
        <label className="field">
          <span>Question</span>
          <input
            type="text"
            value={shownPrompt}
            maxLength={200}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
      ) : null}
      {error ? <p className="line tone-bad">{error}</p> : null}
      <Button
        variant="primary"
        type="submit"
        disabled={busy || !fen || problem !== null || remaining <= 0}
      >
        {busy ? 'Posting…' : 'Post'}
      </Button>
      <Footer sub={sub} remaining={remaining} />
    </form>
  );
}
