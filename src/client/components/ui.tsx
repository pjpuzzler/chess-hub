import { showLoginPrompt, showShareSheet } from '@devvit/web/client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'plain' | 'link';
};

export function Button({ variant = 'plain', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${className ?? ''}`}
      {...rest}
    />
  );
}

export type Tab<T extends string> = { id: T; label: string };

// Plain text tabs (underline marks the current one).
export function TextTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="text-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className="text-tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

// One line of text; colour only when it means something.
export function Line({
  tone,
  children,
}: {
  tone?: 'good' | 'bad' | 'muted' | undefined;
  children: ReactNode;
}) {
  return <p className={`line ${tone ? `tone-${tone}` : ''}`}>{children}</p>;
}

export type IconName =
  | 'first'
  | 'prev'
  | 'next'
  | 'last'
  | 'flip'
  | 'hint'
  | 'eye'
  | 'flame'
  | 'keyboard'
  | 'play'
  | 'pause'
  | 'close'
  | 'minus'
  | 'plus'
  | 'share'
  | 'chart';

const PATHS: Record<IconName, string> = {
  first: 'M6 5v14M18 6l-8 6 8 6z',
  prev: 'M16 6l-8 6 8 6z',
  next: 'M8 6l8 6-8 6z',
  last: 'M18 5v14M6 6l8 6-8 6z',
  flip: 'M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l-3 3m3-3l3 3',
  hint: 'M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  flame:
    'M12 22c4 0 7-2.7 7-6.6 0-3.1-2-5.6-3.6-7.4-.4 1.9-1.4 3.2-2.7 3.6.4-3.4-1-6.6-4.2-8.6.3 3.3-1.5 5.6-3 7.6A8 8 0 0 0 5 15.4C5 19.3 8 22 12 22z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  close: 'M6 6l12 12M18 6L6 18',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  share: 'M12 15V3m0 0L8 7m4-4l4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
};
const FILLED = new Set<IconName>([
  'first',
  'prev',
  'next',
  'last',
  'flame',
  'play',
  'pause',
]);

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Bottom-bar button: icon on top, optional tiny label.
export function NavButton({
  icon,
  label,
  showLabel = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <button type="button" className="nav-btn" aria-label={label} {...rest}>
      <Icon name={icon} />
      {showLabel ? <span className="nav-label">{label}</span> : null}
    </button>
  );
}

// The share sheet as a text link, for rows of links in detail sheets.
export function ShareLink({ text }: { text: string }) {
  return (
    <Button
      variant="link"
      onClick={() => {
        showShareSheet({ text }).catch((err: unknown) =>
          console.error('share failed', err)
        );
      }}
    >
      Share
    </Button>
  );
}

// Small share action for finished states (Reddit's native share sheet).
export function ShareButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="icon-btn share-btn"
      aria-label="Share"
      onClick={() => {
        showShareSheet({ text }).catch((err: unknown) =>
          console.error('share failed', err)
        );
      }}
    >
      <Icon name="share" size={18} />
    </button>
  );
}

// Finished states for logged-out viewers: one button, never mid-activity.
export function LoginButton({ children }: { children: ReactNode }) {
  return (
    <Button onClick={() => showLoginPrompt()} className="login-btn">
      {children}
    </Button>
  );
}
