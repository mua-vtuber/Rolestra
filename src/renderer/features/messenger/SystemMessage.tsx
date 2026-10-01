/**
 * SystemMessage — 시스템 알림 한 줄 (spec 2026-10-01-messenger-redesign.md R3-5).
 *
 * 침묵, 모두 침묵, 실패, 넘김 행이 여기로 온다.
 * - 말풍선 방식(bubbles): 가운데 작은 띠 (`notice` 토큰 배경·글자, 컨트롤 모서리 깎기).
 * - 로그 방식(log): `* 문구` 한 줄 (앞 이모지는 뗀다).
 * 침묵·넘김은 흐린 글자(quiet), 실패는 보통 글자다. 색은 전부 토큰 — hex 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import { chatNoticeText, isQuietChatNotice } from './chat-notice';
import type { Message as ChannelMessage } from '../../../shared/message-types';

export interface SystemMessageProps {
  message: ChannelMessage;
  className?: string;
}

/** prep §2.3.2: 로그 방식에서 떼는 앞 이모지 (나머지 일반 문자는 건드리지 않음). */
const LEADING_EMOJI_RE = /^[\u{1F4CC}\u{1F5F3}✅]\s*/u;

/** Log layout prefix of a notice line (`* 소라는 이번에 말하지 않았습니다`). */
const LOG_NOTICE_MARK = '*';

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
  const noticeText = chatNoticeText(t, message);
  if (noticeText !== null) return noticeText;
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
  const { themeKey, token } = useTheme();
  const displayContent = useDisplayContent(message);
  // W4: a chosen silence (or the user's pass) is not an error — it reads as a faint aside.
  const quiet = isQuietChatNotice(message);

  const rootAttrs = {
    'data-testid': 'system-message',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
    'data-tone': quiet ? 'quiet' : 'normal',
  } as const;

  if (token.messageLayout === 'log') {
    return (
      <div {...rootAttrs} className={clsx('text-meta text-fg-muted', quiet && 'opacity-80', className)}>
        <span data-testid="system-message-body" data-shape="log-star">
          {`${LOG_NOTICE_MARK} ${displayContent.replace(LEADING_EMOJI_RE, '')}`}
        </span>
      </div>
    );
  }

  return (
    <div {...rootAttrs} className={clsx('mb-0.5 mt-2.5 flex justify-center', className)}>
      <span data-testid="system-message-body" data-shape="band"
        className={clsx('inline-block bg-notice-bg px-3 py-1 text-meta [clip-path:var(--clip-control)]',
          quiet ? 'text-notice-fg' : 'text-fg')}>
        {displayContent}
      </span>
    </div>
  );
}
