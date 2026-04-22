/**
 * SystemMessage — 시스템 공지 메시지 버블 (R5-Task6).
 *
 * prep §2.3.2 3-way 형태 차이:
 * - warm    : pill (rounded-full) + border-soft + 중앙 정렬 + fg-muted
 * - tactical: rounded-none + `${brand}10` bg + `${brand}44` border + 중앙 정렬
 * - retro   : `— {content-without-emoji} —` mono dash 1-liner, 이모지 prefix 제거
 *
 * 색상은 CSS variable 경유 — hex literal 금지 (source-level regex guard).
 */
import { clsx } from 'clsx';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { Message as ChannelMessage } from '../../../shared/message-types';

export interface SystemMessageProps {
  message: ChannelMessage;
  className?: string;
}

/** prep §2.3.2: retro 에서 보존 대상 이모지 세트 (나머지 일반 문자는 건드리지 않음). */
const LEADING_EMOJI_RE = /^[\u{1F4CC}\u{1F5F3}✅]\s*/u;

const TACTICAL_BG = 'color-mix(in srgb, var(--color-brand) 10%, transparent)';
const TACTICAL_BORDER =
  'color-mix(in srgb, var(--color-brand) 44%, transparent)';

/**
 * R8-Task9: derive the user-visible text from the persisted system message.
 * Most system messages render `displayContent` verbatim, but the
 * meeting-turn-skipped marker arrives with a structured `meta.turnSkipped`
 * payload + a placeholder content string. We translate it into the proper
 * i18n template here so the human-readable string lives in the locale
 * bundles, not the DB.
 */
function useDisplayContent(message: ChannelMessage): string {
  const { t } = useTranslation();
  const meta = message.meta;
  if (
    meta !== null &&
    typeof meta === 'object' &&
    'turnSkipped' in meta &&
    meta.turnSkipped !== null &&
    typeof meta.turnSkipped === 'object'
  ) {
    const ts = meta.turnSkipped as {
      participantName?: unknown;
      reason?: unknown;
    };
    const name = typeof ts.participantName === 'string' ? ts.participantName : '';
    const reason = typeof ts.reason === 'string' ? ts.reason : '';
    return t('meeting.turnSkipped', { name, reason });
  }
  return message.content;
}

export function SystemMessage({
  message,
  className,
}: SystemMessageProps): ReactElement {
  const { themeKey } = useTheme();
  const displayContent = useDisplayContent(message);

  const rootAttrs = {
    'data-testid': 'system-message',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
  } as const;

  if (themeKey === 'retro') {
    const stripped = displayContent.replace(LEADING_EMOJI_RE, '');
    return (
      <div
        {...rootAttrs}
        className={clsx(
          'flex justify-center px-4 py-1 font-mono text-xs text-fg-subtle',
          className,
        )}
      >
        <span
          data-testid="system-message-body"
          data-shape="mono-dash"
        >{`— ${stripped} —`}</span>
      </div>
    );
  }

  if (themeKey === 'tactical') {
    const style: CSSProperties = {
      backgroundColor: TACTICAL_BG,
      border: `1px solid ${TACTICAL_BORDER}`,
    };
    return (
      <div
        {...rootAttrs}
        className={clsx('flex justify-center px-4 py-1', className)}
      >
        <span
          data-testid="system-message-body"
          data-shape="tactical-outline"
          className="inline-block rounded-none px-3 py-1 font-sans text-xs text-fg-muted"
          style={style}
        >
          {displayContent}
        </span>
      </div>
    );
  }

  return (
    <div
      {...rootAttrs}
      className={clsx('flex justify-center px-4 py-1', className)}
    >
      <span
        data-testid="system-message-body"
        data-shape="pill"
        className="inline-block rounded-full border border-border-soft bg-elev px-3 py-1 font-sans text-xs text-fg-muted"
      >
        {displayContent}
      </span>
    </div>
  );
}
