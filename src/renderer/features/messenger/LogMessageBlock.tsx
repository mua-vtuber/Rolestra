/**
 * LogMessageBlock — one speaker's block in the log layout (retro, spec
 * 2026-10-01-messenger-redesign.md R3-3/R3-4), like a PC-통신 chat log:
 *
 *   이름 [21:12]
 *   └ 첫 줄
 *   └ 이어진 줄
 *
 * The name is in the speaker's seat color; the user is "나" in the brand
 * color. A whisper block is entirely in the whisper color and its name
 * line is the route ("A → B · 귓속말"). No borders, no avatars.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { LOG_LINE_MARK } from '../../theme/log-layout';
import { seatNameTextClass } from '../../theme/name-palette';
import { useTheme } from '../../theme/use-theme';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import type { MessageSpeaker } from './Message';
import { messageDataAttrs } from './message-attrs';
import { clockTime } from './time-format';
import { WhisperLabel } from './WhisperLabel';

export interface LogMessageBlockProps {
  /** One speaker's consecutive messages (a whisper block has exactly one). */
  messages: ChannelMessage[];
  speaker: MessageSpeaker | null;
}

export function LogMessageBlock({ messages, speaker }: LogMessageBlockProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { themeKey } = useTheme();
  const head = messages[0];
  if (head === undefined) return null;
  const whisper = head.visibility === 'whisper' ? head.whisper : undefined;
  const user = head.authorKind === 'user';

  return (
    <div data-testid="message-block" data-visibility={whisper ? 'whisper' : 'public'}
      className={clsx('flex flex-col gap-0.5 text-body', whisper ? 'text-whisper-fg' : 'text-fg')}>
      <div className="flex items-baseline gap-2.5">
        {whisper ? (
          <span className="font-bold"><WhisperLabel message={head} whisper={whisper} /></span>
        ) : (
          <span data-testid="message-name"
            className={clsx('font-bold', user ? 'text-brand-text'
              : speaker === null ? 'text-fg-muted' : seatNameTextClass(speaker.seat))}>
            {user ? t('messenger.log.me') : speaker?.name ?? t('messenger.activity.unknownName')}
          </span>
        )}
        <span data-testid="message-time" className={clsx('text-meta', whisper ? 'text-whisper-fg' : 'text-fg-muted')}>
          {t('messenger.log.time', { time: clockTime(head.createdAt, i18n.language) })}
        </span>
      </div>
      {messages.map((message, index) => (
        <div key={message.id} {...messageDataAttrs(message, themeKey, index > 0)} className="flex gap-2">
          <span aria-hidden="true" className={clsx('shrink-0', whisper ? 'text-whisper-fg' : 'text-log-mark')}>
            {LOG_LINE_MARK}
          </span>
          <span data-testid="message-content" className="whitespace-pre-wrap break-words">{message.content}</span>
        </div>
      ))}
    </div>
  );
}
