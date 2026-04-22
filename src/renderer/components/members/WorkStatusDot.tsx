/**
 * WorkStatusDot — 4-state work-status indicator (R8-Task2, spec §7.2).
 *
 * Maps {@link WorkStatus} to a coloured dot + i18n label:
 *
 *   | status               | tone class       | i18n key                     | aria-label semantics |
 *   | -------------------- | ---------------- | ---------------------------- | -------------------- |
 *   | `online`             | `bg-success`     | `member.status.online`       | "출근"               |
 *   | `connecting`         | `bg-warning`     | `member.status.connecting`   | "재연결 중" (pulse)  |
 *   | `offline-connection` | `bg-danger`     | `member.status.offlineConnection` | "점검 필요"     |
 *   | `offline-manual`     | `bg-fg-muted`    | `member.status.offlineManual`| "외근"               |
 *
 * Spec §7.2 distinguishes `offline-connection` ("점검 필요" — red, system
 * issue) from `offline-manual` ("외근" — gray, user choice). R5 MemberRow
 * collapsed both to `bg-fg-muted` because the row only had room for a 2 px
 * dot and no label. R8 promotes the dot wherever it appears next to a
 * label (Popover, Avatar grid hover) — so we restore the spec-mandated
 * red for `offline-connection` here. R5 MemberRow keeps its compact
 * mapping; the Popover (Task 6) uses this component directly with
 * `showLabel={true}`.
 *
 * `connecting` runs Tailwind's `animate-pulse` so users see motion while
 * the warmup probe is in flight (~5 s per D3). Other states are static.
 *
 * a11y: The dot is `aria-hidden` (purely decorative); the human-readable
 * text comes from the label span (`showLabel=true`) or the wrapping
 * `aria-label` (`showLabel=false`). Either way, screen readers announce
 * the state — never silent. The component will throw a TS error at the
 * call site if neither is configured, since both default to a sensible
 * value (label hidden but aria-label fallback active).
 */

import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkStatus } from '../../../shared/member-profile-types';

/** Tone class per status. Centralised so test + UI agree on one mapping. */
export const WORK_STATUS_DOT_CLASS: Record<WorkStatus, string> = {
  online: 'bg-success',
  connecting: 'bg-warning animate-pulse',
  'offline-connection': 'bg-danger',
  'offline-manual': 'bg-fg-muted',
};

/** i18n key per status. */
export const WORK_STATUS_I18N_KEY: Record<WorkStatus, string> = {
  online: 'member.status.online',
  connecting: 'member.status.connecting',
  'offline-connection': 'member.status.offlineConnection',
  'offline-manual': 'member.status.offlineManual',
};

export interface WorkStatusDotProps {
  status: WorkStatus;
  /** Pixel diameter. Defaults to 8 (matches R5 MemberRow). */
  size?: number;
  /**
   * When true, render the i18n label next to the dot. Default false (used
   * inline next to a name where space is tight). The Popover sets
   * `showLabel` so the user sees the textual state directly under the
   * member name.
   */
  showLabel?: boolean;
  className?: string;
}

export function WorkStatusDot({
  status,
  size = 8,
  showLabel = false,
  className,
}: WorkStatusDotProps): ReactElement {
  const { t } = useTranslation();
  const label = t(WORK_STATUS_I18N_KEY[status]);
  return (
    <span
      data-testid="work-status-dot"
      data-status={status}
      className={clsx('inline-flex items-center gap-1.5', className)}
      // When label is hidden the wrapper carries the screen-reader text.
      aria-label={showLabel ? undefined : label}
      role="status"
    >
      <span
        aria-hidden="true"
        className={clsx('shrink-0 rounded-full', WORK_STATUS_DOT_CLASS[status])}
        style={{ width: size, height: size }}
      />
      {showLabel && (
        <span data-testid="work-status-label" className="text-xs text-fg-muted">
          {label}
        </span>
      )}
    </span>
  );
}
