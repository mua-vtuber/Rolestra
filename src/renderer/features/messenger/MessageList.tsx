/**
 * A channel's rows in the theme's message layout (spec
 * 2026-10-01-messenger-redesign.md R3-2..R3-5). Grouping rules live in
 * `message-rows.ts`; this only picks the component per row. A plain
 * function (no hooks) so the thread can tell an empty list from a full one.
 */
import type { ReactElement } from 'react';

import type { MessageLayout } from '../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import { DateSeparator } from './DateSeparator';
import { LogMessageBlock } from './LogMessageBlock';
import { Message, type MessageSpeaker } from './Message';
import { buildMessageRows } from './message-rows';
import { SystemMessage } from './SystemMessage';
import { longDateLabel } from './time-format';

export function renderMessageList(
  messages: readonly ChannelMessage[],
  /** providerId → speaker (name, seat, profile) from the channel's member list. */
  speakers: ReadonlyMap<string, MessageSpeaker>,
  layout: MessageLayout,
  language: string,
): ReactElement[] {
  return buildMessageRows(messages, layout).map((row) => {
    switch (row.kind) {
      case 'date':
        return <DateSeparator key={row.key} label={longDateLabel(row.timestamp, language)} />;
      case 'notice':
        return <SystemMessage key={row.key} message={row.message} />;
      case 'message':
        return <Message key={row.key} message={row.message} groupStart={row.groupStart}
          speaker={speakers.get(row.message.authorId) ?? null} />;
      case 'log-block': {
        const authorId = row.messages[0]?.authorId;
        return <LogMessageBlock key={row.key} messages={row.messages}
          speaker={authorId === undefined ? null : speakers.get(authorId) ?? null} />;
      }
    }
  });
}
