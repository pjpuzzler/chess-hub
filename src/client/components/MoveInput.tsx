import { useState, type FormEvent } from 'react';
import { parseMoveText } from '../lib/chess';

// Keyboard / screen-reader move entry: SAN ("Nf3") or UCI ("g1f3"). Opened
// from the bottom bar's Type button; takes over the panel's summary row.
export function MoveInput({
  fen,
  disabled,
  onMove,
  onClose,
}: {
  fen: string;
  disabled: boolean;
  onMove: (uci: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || !text.trim()) return;
    const uci = parseMoveText(fen, text);
    if (!uci) {
      setError(`${text.trim()} isn’t legal here`);
      return;
    }
    setError(null);
    setText('');
    onMove(uci);
  };

  return (
    <form className="move-input" onSubmit={submit}>
      <input
        className="move-input-field"
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Type a move, like Nf3"
        aria-label="Type a move and press Enter"
        enterKeyHint="go"
        // The field opens on a tap of Type, so focusing it is expected.
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // readOnly, not disabled, so keyboard focus survives the opponent's reply.
        readOnly={disabled}
        aria-disabled={disabled}
        aria-invalid={error !== null}
      />
      {error ? (
        <span className="move-input-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
