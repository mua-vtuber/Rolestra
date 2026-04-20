import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ShellTopBarProps {
  /** Office / tenant display name (e.g. '사무실'). */
  title: string;
  /** Short secondary label — time + greeting. No marketing copy. */
  subtitle?: string;
  /** Optional right-side slot for actions (notifications, search, avatar). */
  rightSlot?: ReactNode;
  className?: string;
}

export function ShellTopBar({ title, subtitle, rightSlot, className }: ShellTopBarProps) {
  return (
    <header
      data-testid="shell-topbar"
      className={clsx(
        'flex items-center gap-3 px-4 py-2 min-h-[46px]',
        'bg-topbar-bg border-b border-topbar-border shrink-0',
        className
      )}
    >
      <div className="flex items-baseline gap-2.5 min-w-0">
        <span className="text-xl font-bold font-display text-fg tracking-tight">{title}</span>
        {subtitle && (
          <span className="text-xs text-fg-muted truncate">{subtitle}</span>
        )}
      </div>
      <div className="flex-1" />
      {rightSlot}
    </header>
  );
}
