import { context, navigateTo, showToast } from '@devvit/web/client';
import { useState, type FormEvent } from 'react';
import { api, friendlyError } from '../lib/api';
import { turnOf } from '../lib/chess';
import { Footer } from './CreateSheet';
import { MiniBoard } from './MiniBoard';
import { Sheet } from './Sheet';
import { Button } from './ui';

const CLOSE_OPTIONS = [
  { hours: 0, label: 'Never' },
  { hours: 6, label: '6 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
];

// Post a poll of the board position (members and mods; posts as the user).
export function PollCreateSheet({
  fen,
  lastMove,
  orientation,
  remaining,
  onClose,
}: {
  fen: string;
  lastMove: string | null;
  orientation: 'white' | 'black';
  remaining: number; // member posts left today
  onClose: () => void;
}) {
  const sub = context.subredditName
    ? `r/${context.subredditName}`
    : 'this subreddit';
  const side = turnOf(fen) === 'white' ? 'White' : 'Black';
  const [prompt, setPrompt] = useState(`${side} to play`);
  const [closeHours, setCloseHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.pollCreate({
        fen,
        prompt: prompt.trim(),
        closeHours,
        lastMove,
      });
      showToast('Poll posted');
      onClose();
      navigateTo(res.url);
    } catch (err) {
      console.error('poll create failed', err);
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title="New poll" onClose={onClose}>
      <form className="sheet-form" onSubmit={(e) => void submit(e)}>
        <div className="sheet-preview">
          <MiniBoard fen={fen} orientation={orientation} size={96} />
          <span className="muted">{side} to move</span>
        </div>
        <label className="field">
          <span>Question</span>
          <input
            type="text"
            value={prompt}
            maxLength={200}
            required
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Voting closes after</span>
          <select
            value={closeHours}
            onChange={(e) => setCloseHours(Number(e.target.value))}
          >
            {CLOSE_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="line tone-bad">{error}</p> : null}
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !prompt.trim()}
        >
          {busy ? 'Posting…' : 'Post poll'}
        </Button>
        <Footer sub={sub} remaining={remaining} />
      </form>
    </Sheet>
  );
}
