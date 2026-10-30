import { useEffect } from 'react';

// Arrow keys / Home / End step through moves while `active` (desktop).
export function useMoveKeys(
  active: boolean,
  index: number,
  length: number,
  go: (index: number) => void
): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)
        return;
      if (t instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') go(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') go(Math.min(length, index + 1));
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(length);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, index, length, go]);
}
