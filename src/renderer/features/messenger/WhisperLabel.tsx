/**
 * "Alice → Bob · 귓속말" — the route and kind of a whisper, the same in
 * both layouts (spec 2026-10-01-messenger-redesign.md R3-4). The kind keeps
 * the thread rules as they are: the root is "귓속말", a reply shows its
 * position ("비공개 답장 · 2/4"). The route's tooltip names the two ids.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from '../../../shared/chat-thread-limits';
import type { Message as ChannelMessage, WhisperDetails } from '../../../shared/message-types';

export function WhisperLabel({ message, whisper }: {
  message: ChannelMessage;
  whisper: WhisperDetails;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span data-testid="message-whisper-details" className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span data-testid="message-whisper-route" className="min-w-0 break-words"
        title={t('messenger.whisper.routeIdentity', { senderId: message.authorId, recipientId: whisper.recipientId })}>
        {whisper.senderName} {'→'} {whisper.recipientName}
      </span>
      <span aria-hidden="true">{'·'}</span>
      <span data-testid="message-whisper-kind">
        {whisper.replyToMessageId === null
          ? t('messenger.whisper.label')
          : t('messenger.whisper.threadReplyLabel', {
            position: whisper.threadSeq, max: CHAT_WHISPER_THREAD_MAX_MESSAGES })}
      </span>
    </span>
  );
}
