import { useEffect, useId, useRef, type ReactNode } from 'react';

// Bottom sheet (centered dialog on wide screens). Focus goes to the dialog
// itself, not a field, so phones don't pop the keyboard; Escape closes.
export function Sheet({
  title,
  onClose,
  children,
  fromY,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  // Opened from a grab bar at this viewport y: the sheet reaches at least up
  // to it, so it visibly comes out of the handle however short it is.
  fromY?: number | undefined;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        style={
          fromY === undefined
            ? undefined
            : { minHeight: `${Math.max(0, window.innerHeight - fromY)}px` }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id={id} className="sheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
