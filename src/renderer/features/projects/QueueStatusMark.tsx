/**
 * QueueStatusMark — 큐 항목 상태 표시 (시안 04 `QRow` 의 status mark 분기).
 *
 * - retro: ASCII bracket text(`[✓]/[→]/[ ]/[✗]/[‖]/[/]`) — mono, status color, bold
 * - 그외: small status dot + uppercase mono label
 * - 진행 중(`in_progress`) 항목은 살짝 펄스(작은 dot 글로우는 추후 — 우선 색만)
 *
 * 라벨은 기존 `queue.status.*` 키 재사용. ASCII variant 는 `queue.statusMark.*` 새 서브트리.
 *
 * hex literal 금지 — 색은 Tailwind utility 만.
 */
import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { QueueItemStatus } from '../../../shared/queue-types';

export interface QueueStatusMarkProps {
  status: QueueItemStatus;
  /** 라벨 텍스트 표시 여부. false 면 dot/ASCII 만 (compact 표 셀 등). */
  showLabel?: boolean;
  className?: string;
}

const TONE_BY_STATUS: Record<
  QueueItemStatus,
  { textClass: string; dotClass: string }
> = {
  done: { textClass: 'text-success', dotClass: 'bg-success' },
  in_progress: { textClass: 'text-warning', dotClass: 'bg-warning' },
  failed: { textClass: 'text-danger', dotClass: 'bg-danger' },
  paused: { textClass: 'text-fg-muted', dotClass: 'bg-fg-muted' },
  cancelled: { textClass: 'text-fg-muted', dotClass: 'bg-fg-muted' },
  pending: { textClass: 'text-fg-subtle', dotClass: 'bg-fg-subtle' },
};

function asciiI18nKey(status: QueueItemStatus): string {
  switch (status) {
    case 'done':
      return 'queue.statusMark.done';
    case 'in_progress':
      return 'queue.statusMark.inProgress';
    case 'failed':
      return 'queue.statusMark.failed';
    case 'paused':
      return 'queue.statusMark.paused';
    case 'cancelled':
      return 'queue.statusMark.cancelled';
    case 'pending':
    default:
      return 'queue.statusMark.pending';
  }
}

function labelI18nKey(status: QueueItemStatus): string {
  switch (status) {
    case 'done':
      return 'queue.status.done';
    case 'in_progress':
      return 'queue.status.inProgress';
    case 'failed':
      return 'queue.status.failed';
    case 'paused':
      return 'queue.status.paused';
    case 'cancelled':
      return 'queue.status.cancelled';
    case 'pending':
    default:
      return 'queue.status.pending';
  }
}

export function QueueStatusMark({
  status,
  showLabel = true,
  className,
}: QueueStatusMarkProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const tone = TONE_BY_STATUS[status];
  const isRetro = themeKey === 'retro';
  const isActive = status === 'in_progress';
  const ascii = t(asciiI18nKey(status));
  const label = t(labelI18nKey(status));

  return (
    <span
      data-testid="queue-status-mark"
      data-status={status}
      data-theme-variant={themeKey}
      className={clsx(
        'inline-flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-wider uppercase',
        tone.textClass,
        className,
      )}
    >
      {isRetro ? (
        <span
          data-testid="queue-status-mark-ascii"
          aria-hidden="true"
          className={clsx(
            'leading-none',
            isActive && 'animate-pulse',
          )}
        >
          {ascii}
        </span>
      ) : (
        <span
          data-testid="queue-status-mark-dot"
          aria-hidden="true"
          className={clsx(
            'h-2 w-2 rounded-full shrink-0',
            tone.dotClass,
            isActive && 'animate-pulse',
          )}
        />
      )}
      {showLabel ? (
        <span data-testid="queue-status-mark-label">{label}</span>
      ) : null}
    </span>
  );
}
