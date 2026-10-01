/**
 * DateSeparator — 날짜 구분선 (spec 2026-10-01-messenger-redesign.md R3-2/R3-3).
 *
 * 말풍선 방식: 가는 선 사이 가운데 날짜. 로그 방식: `──── 날짜 ────` 한 줄.
 * 호출자는 이미 포맷된 라벨을 넘긴다. hex literal 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import { useTheme } from '../../theme/use-theme';

export interface DateSeparatorProps {
  label: string;
  className?: string;
}

/** The rule drawn on each side of the date in the log layout. */
const LOG_DATE_RULE = '────────';

export function DateSeparator({ label, className }: DateSeparatorProps): ReactElement {
  const { token } = useTheme();
  if (token.messageLayout === 'log') {
    return (
      <div data-testid="date-separator" data-label={label} role="separator"
        className={clsx('whitespace-pre font-mono text-meta text-fg-muted', className)}>
        <span data-testid="date-separator-label">{`${LOG_DATE_RULE} ${label} ${LOG_DATE_RULE}`}</span>
      </div>
    );
  }
  return (
    <div data-testid="date-separator" data-label={label} role="separator"
      className={clsx('mb-2.5 mt-1 flex items-center gap-3 font-mono text-meta text-fg-muted', className)}>
      <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
      <span data-testid="date-separator-label">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
    </div>
  );
}
