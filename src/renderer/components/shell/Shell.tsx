import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ShellProps {
  nav: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shell — application root layout (spec 2026-10-01-messenger-redesign.md
 * R2-1: no top bar; each view lays out its own columns).
 *
 *   ┌──────┬──────────────────────────────────┐
 *   │ Nav  │ children (chat list + room,      │
 *   │ 64px │ AI list, or settings)            │
 *   └──────┴──────────────────────────────────┘
 *
 * The retro-dark scanline overlay (`--overlay-screen`, `none` elsewhere)
 * covers the whole window without taking clicks.
 */
export function Shell({ nav, children, className }: ShellProps) {
  return (
    <div
      data-testid="shell-root"
      className={clsx(
        'relative flex h-full w-full overflow-hidden bg-canvas font-sans text-fg',
        className,
      )}
    >
      {nav}
      <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
      <div
        aria-hidden="true"
        data-testid="shell-screen-overlay"
        className="pointer-events-none absolute inset-0 bg-screen-overlay"
      />
    </div>
  );
}
