/**
 * Pure rules of the chat list (spec 2026-10-01-messenger-redesign.md R2-2):
 * order, filters, labels, preview text, time and unread badges.
 *
 * - Order: newest activity first; the channel id breaks ties so the order
 *   never flickers.
 * - Filters: 전체/채팅방 = active rooms and the general channel;
 *   보관함 = archived rooms only. Legacy DMs have no user-facing entry.
 * - Preview: "이름: 내용" for rooms and general, plain content for a DM's AI,
 *   "나: 내용" for the user; a whisper shows only "A → B 귓속말"; notice and
 *   pass rows are translated from their codes (`chat-notice.ts`).
 */
import type { TFunction } from 'i18next';

import { chatNoticeText } from '../messenger/chat-notice';
import { clockTime, uiLocale } from '../messenger/time-format';
import {
  UNREAD_COUNT_DISPLAY_MAX,
  type ChannelSummary,
} from '../../../shared/channel-summary-types';
import type { MessageMeta } from '../../../shared/message-types';

export const CHAT_LIST_FILTERS = ['all', 'rooms', 'archive'] as const;
export type ChatListFilter = (typeof CHAT_LIST_FILTERS)[number];

export function isArchivedRoom(summary: ChannelSummary): boolean {
  return summary.kind === 'room' && summary.archivedAt !== null;
}

export function matchesFilter(summary: ChannelSummary, filter: ChatListFilter): boolean {
  if (summary.kind === 'dm') return false;
  switch (filter) {
    case 'all': return !isArchivedRoom(summary);
    case 'rooms': return !isArchivedRoom(summary);
    case 'archive': return isArchivedRoom(summary);
  }
}

export function sortByActivity(list: readonly ChannelSummary[]): ChannelSummary[] {
  return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt ||
    a.channelId.localeCompare(b.channelId));
}

/** The conversation's name as the list and the room header show it. */
export function conversationLabel(t: TFunction, summary: ChannelSummary): string {
  switch (summary.kind) {
    case 'general': return t('chatList.generalName');
    case 'dm': return summary.participants[0]?.displayName ?? t('chatList.deletedAi');
    case 'room': return summary.name;
  }
}

function speakerName(t: TFunction, summary: ChannelSummary, authorId: string): string {
  return summary.participants.find((p) => p.providerId === authorId)?.displayName
    ?? t('messenger.activity.unknownName');
}

export function previewText(t: TFunction, summary: ChannelSummary): string {
  const last = summary.lastMessage;
  if (last === null) return t('chatList.noMessages');
  if (last.whisper !== null) {
    return t('chatList.preview.whisper', { from: last.whisper.senderName, to: last.whisper.recipientName });
  }
  const notice = chatNoticeText(t, {
    authorKind: last.authorKind, role: last.role, meta: (last.notice ?? null) as MessageMeta | null,
  });
  if (notice !== null) return notice;
  const content = last.content ?? '';
  if (last.authorKind === 'user') return t('chatList.preview.mine', { text: content });
  if (summary.kind === 'dm') return content;
  return t('chatList.preview.named', { name: speakerName(t, summary, last.authorId), text: content });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today → hh:mm, yesterday → "어제", this year → month/day, older → full date. */
export function listTimeLabel(t: TFunction, timestamp: number, now: number, language: string): string {
  const when = new Date(timestamp);
  const today = new Date(now);
  if (sameDay(when, today)) return clockTime(timestamp, language);
  const locale = uiLocale(language);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(when, yesterday)) return t('chatList.yesterday');
  return when.getFullYear() === today.getFullYear()
    ? when.toLocaleDateString(locale, { month: 'long', day: 'numeric' })
    : when.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** "3", or "99+" past the display cap; null when there is nothing unread. */
export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > UNREAD_COUNT_DISPLAY_MAX ? `${UNREAD_COUNT_DISPLAY_MAX}+` : String(count);
}

/** Conversations whose label or preview contains the query (case-insensitive). */
export function matchesQuery(t: TFunction, summary: ChannelSummary, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  return conversationLabel(t, summary).toLocaleLowerCase().includes(needle) ||
    previewText(t, summary).toLocaleLowerCase().includes(needle);
}

export function visibleRows(
  t: TFunction,
  list: readonly ChannelSummary[],
  filter: ChatListFilter,
  query: string,
): ChannelSummary[] {
  return sortByActivity(list.filter((summary) => matchesFilter(summary, filter) && matchesQuery(t, summary, query)));
}
