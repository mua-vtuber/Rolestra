/**
 * TypingIndicator — "XX — 작성 중" placeholder (R5-Task9).
 *
 * R5 에서는 SSM 이벤트 스트림이 wired 되지 않아 구체적 typing 사용자
 * 리스트를 받지 못한다. 호출자가 names 를 넘기면 그대로 표시하고,
 * 빈 배열이면 null 을 반환한다(렌더 자체를 생략). R6 에서 stream
 * event 를 hook 으로 받아 이 컴포넌트를 살아있게 만든다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface TypingIndicatorProps {
  /** Display names of the currently typing members. Empty → null return. */
  names: readonly string[];
  className?: string;
}

export function TypingIndicator({
  names,
  className,
}: TypingIndicatorProps): ReactElement | null {
  const { t } = useTranslation();
  if (names.length === 0) return null;
  const joined = names.join(', ');
  return (
    <div
      data-testid="typing-indicator"
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 text-xs text-fg-muted',
        className,
      )}
    >
      <span
        data-testid="typing-indicator-dots"
        aria-hidden="true"
        className="inline-flex gap-0.5"
      >
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-fg-muted" />
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-fg-muted [animation-delay:150ms]" />
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-fg-muted [animation-delay:300ms]" />
      </span>
      <span data-testid="typing-indicator-label">
        {t('messenger.typing.label', { names: joined })}
      </span>
    </div>
  );
}
