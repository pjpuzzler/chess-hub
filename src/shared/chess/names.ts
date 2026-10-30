// Player names from PGN headers. The PGN standard writes "Last, First M."
// ("Fischer, Robert James", "Fischer, Robert J.", "van Wely, Loek"); Lichess
// and chess.com exports use a username. We show "Robert James Fischer" in
// full and the surname ("Fischer") where space is short, never initials.

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// "J." or "J" on its own is an initial, not a name.
const isInitial = (token: string) => /^\p{L}\.?$/u.test(token);

/** "Fischer, Robert James" -> "Robert James Fischer"; others unchanged. */
export function displayName(raw: string): string {
  const name = clean(raw);
  const parts = name.split(',').map(clean);
  const [last, first, ...rest] = parts;
  if (!last || !first) return clean(name.replace(/,/g, ' ')) || name;
  return [first, last, ...rest].filter(Boolean).join(' ');
}

/** The surname alone: "Fischer, Robert J." -> "Fischer", "Magnus Carlsen" -> "Carlsen". */
export function surname(raw: string): string {
  const name = clean(raw);
  if (name.includes(',')) {
    const last = clean(name.split(',')[0] ?? '');
    if (last) return last;
  }
  const tokens = name.split(' ').filter((t) => !isInitial(t));
  return tokens.at(-1) ?? name;
}
