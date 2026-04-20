import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ShellProps {
  nav: ReactNode;
  rail: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shell — application root layout.
 *
 *   ┌──────┬────────┬──────────────────────────┐
 *   │ Nav  │ Rail   │ TopBar                   │
 *   │ 64px │ 240px  ├──────────────────────────┤
 *   │      │        │ children (main)          │
 *   └──────┴────────┴──────────────────────────┘
 */
export function Shell({ nav, rail, topBar, children, className }: ShellProps) {
  return (
    <div
      data-testid="shell-root"
      className={clsx(
        'h-full w-full flex bg-canvas text-fg font-sans overflow-hidden',
        className
      )}
    >
      {nav}
      {rail}
      <div className="flex-1 min-w-0 flex flex-col">
        {topBar}
        <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
