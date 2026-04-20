import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface ShellTopBarProps {
  /** Office / tenant display name (e.g. '사무실'). */
  title: string;
  /** Short secondary label — time + greeting. No marketing copy. */
  subtitle?: string;
  /**
   * Active project name for the subtitle slot.
   *
   * Precedence (highest → lowest):
   *   1. `activeProjectName` truthy string → render as
   *      `"현재 프로젝트: <name>"` using `shell.topbar.activeProjectPrefix`.
   *   2. `activeProjectName === null` (explicit null) → render
   *      `shell.topbar.noActiveProject` ("프로젝트 미선택").
   *   3. `activeProjectName === undefined` → fall back to `subtitle`.
   *
   * The explicit-null case distinguishes "there is no active project"
   * from "the caller doesn't want to show a project slot at all", which
   * matters in App.tsx where we always want to display status even when
   * no project is selected.
   */
  activeProjectName?: string | null;
  /** Optional right-side slot for actions (notifications, search, avatar). */
  rightSlot?: ReactNode;
  className?: string;
}

export function ShellTopBar({
  title,
  subtitle,
  activeProjectName,
  rightSlot,
  className,
}: ShellTopBarProps) {
  const { t } = useTranslation();

  let secondary: string | null;
  if (typeof activeProjectName === 'string' && activeProjectName.length > 0) {
    secondary = `${t('shell.topbar.activeProjectPrefix', '현재 프로젝트')}: ${activeProjectName}`;
  } else if (activeProjectName === null) {
    secondary = t('shell.topbar.noActiveProject', '프로젝트 미선택');
  } else if (subtitle !== undefined && subtitle.length > 0) {
    secondary = subtitle;
  } else {
    secondary = null;
  }

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
        {secondary !== null && (
          <span
            data-testid="shell-topbar-subtitle"
            data-active-project={activeProjectName != null ? 'true' : undefined}
            className="text-xs text-fg-muted truncate"
          >
            {secondary}
          </span>
        )}
      </div>
      <div className="flex-1" />
      {rightSlot}
    </header>
  );
}
