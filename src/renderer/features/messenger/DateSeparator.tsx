/**
 * DateSeparator — 메시지 스트림 중간에 끼는 "— 오늘, 2026년 4월 21일 —"
 * 가로줄 (R5-Task9, token-only).
 *
 * 호출자는 timestamp(ms) 또는 ISO 문자열 대신 "이미 포맷된 라벨" 을
 * 넘긴다 — R6 에서 Thread 렌더러가 날짜 판정 로직을 일괄 적용하도록
 * 책임을 분리한다. R5 에서는 placeholder 로 "오늘" 문구만 렌더할 때
 * 주로 사용된다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

export interface DateSeparatorProps {
  label: string;
  className?: string;
}

export function DateSeparator({
  label,
  className,
}: DateSeparatorProps): ReactElement {
  return (
    <div
      data-testid="date-separator"
      data-label={label}
      className={clsx('flex items-center gap-2 px-4 py-2', className)}
      role="separator"
    >
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-border-soft"
      />
      <span
        data-testid="date-separator-label"
        className="text-[11px] font-medium text-fg-muted"
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-border-soft"
      />
    </div>
  );
}
