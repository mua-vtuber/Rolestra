/**
 * Keeping the chat list current from `stream:channel-message` without
 * re-reading every summary (spec 2026-10-01-messenger-redesign.md R4-4).
 *
 * Each streamed message changes exactly one row: its last message, its last
 * activity time and — for an AI message the user is not looking at — its
 * unread count. These helpers apply that change in memory with the same
 * rules main uses (`channel-summary-repository.ts`): unread counts only AI
 * messages (`member` + `assistant`, public or whisper), a whisper exposes
 * its route but not its text, notice and pass rows keep their codes.
 */
import {
  CHANNEL_PREVIEW_MAX_CHARS,
  type ChannelSummary,
  type ChannelSummaryLastMessage,
  type ChannelSummaryNoticeMeta,
} from '../../../shared/channel-summary-types';
import type { Message } from '../../../shared/message-types';

const NOTICE_META_KEYS = ['chatError', 'chatErrorDetail', 'chatErrorSpeakerName', 'chatSilence', 'chatPass'] as const;

/** An AI message: the only kind the unread count includes. */
export function countsAsUnread(message: Pick<Message, 'authorKind' | 'role'>): boolean {
  return message.authorKind === 'member' && message.role === 'assistant';
}

function noticeMeta(message: Message): ChannelSummaryNoticeMeta | null {
  const meta = message.meta;
  if (meta === null) return null;
  const picked: Record<string, unknown> = {};
  for (const key of NOTICE_META_KEYS) {
    if (meta[key] !== undefined && meta[key] !== null) picked[key] = meta[key];
  }
  return Object.keys(picked).length > 0 ? (picked as ChannelSummaryNoticeMeta) : null;
}

export function toLastMessage(message: Message): ChannelSummaryLastMessage {
  const whisper = message.visibility === 'whisper' ? message.whisper : undefined;
  return {
    id: message.id,
    authorId: message.authorId,
    authorKind: message.authorKind,
    role: message.role,
    createdAt: message.createdAt,
    visibility: whisper ? 'whisper' : 'public',
    // Array.from counts code points, as SQLite substr() counts characters.
    content: whisper ? null : Array.from(message.content).slice(0, CHANNEL_PREVIEW_MAX_CHARS).join(''),
    notice: whisper ? null : noticeMeta(message),
    whisper: whisper ? {
      senderName: whisper.senderName,
      recipientName: whisper.recipientName,
      threadSeq: whisper.threadSeq,
      isReply: whisper.replyToMessageId !== null,
    } : null,
  };
}

/** True when `message` is newer than what the summary already shows. */
export function isNewerThanSummary(summary: ChannelSummary, message: Message): boolean {
  const last = summary.lastMessage;
  if (last === null) return true;
  if (last.id === message.id) return false;
  return message.createdAt >= last.createdAt;
}

/**
 * The row after `message` arrived. `viewing` is true while the user has
 * this channel open in a visible window — the room marks it read itself,
 * so the count does not go up.
 */
export function patchSummary(summary: ChannelSummary, message: Message, viewing: boolean): ChannelSummary {
  if (!isNewerThanSummary(summary, message)) return summary;
  return {
    ...summary,
    lastMessage: toLastMessage(message),
    lastActivityAt: Math.max(summary.lastActivityAt, message.createdAt),
    unreadCount: !viewing && countsAsUnread(message) ? summary.unreadCount + 1 : summary.unreadCount,
  };
}
