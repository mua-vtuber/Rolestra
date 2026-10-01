/**
 * Chat list summaries (spec 2026-10-01-messenger-redesign.md R4): one row
 * per conversation the user sees — the general channel, every chat room
 * (archived ones flagged) and every DM — with what the chat list needs to
 * draw it, read in a fixed number of SQL statements.
 *
 * The last message is shown as the observer (the user) sees it, with two
 * limits: a whisper row carries only its sender and recipient names, never
 * its text, and code rows (failure / silence notices, the pass row) carry
 * their codes so the renderer translates them like the thread does.
 */
import type {
  ChatErrorCode,
  ChatSilenceNotice,
  MessageAuthorKind,
  MessageRole,
  CHAT_PASS_CODE,
} from './message-types';
import type { ChatVoteResult } from './chat-vote-types';

export type ChannelSummaryKind = 'general' | 'room' | 'dm';

/** Someone the list can draw an avatar or a name colour for. */
export interface ChannelSummaryParticipant {
  providerId: string;
  /** Room snapshot name, the DM AI's current name, or the general member's current name. */
  displayName: string;
}

/** The code fields of an observer notice or a pass row (`MessageMeta` subset). */
export interface ChannelSummaryNoticeMeta {
  chatError?: ChatErrorCode;
  chatErrorDetail?: string;
  chatErrorSpeakerName?: string;
  chatSilence?: ChatSilenceNotice;
  chatPass?: typeof CHAT_PASS_CODE;
  chatVoteResult?: ChatVoteResult;
}

export interface ChannelSummaryLastMessage {
  id: string;
  authorId: string;
  authorKind: MessageAuthorKind;
  role: MessageRole;
  createdAt: number;
  visibility: 'public' | 'whisper';
  /**
   * The first {@link CHANNEL_PREVIEW_MAX_CHARS} characters of a public row
   * (a code for a notice or pass row); `null` for a whisper.
   */
  content: string | null;
  /** Code fields when the row is a notice or a pass row, else `null`. */
  notice: ChannelSummaryNoticeMeta | null;
  /** Route of a whisper row (names as stored on the row), else `null`. */
  whisper: { senderName: string; recipientName: string; threadSeq: number; isReply: boolean } | null;
}

export interface ChannelSummary {
  channelId: string;
  kind: ChannelSummaryKind;
  /** Stored channel name (room name; the renderer labels general and DMs itself). */
  name: string;
  /** Rooms only: when the room was archived, else `null`. */
  archivedAt: number | null;
  /** Room participants in seat order, the DM's AI, or every registered AI for general. */
  participants: ChannelSummaryParticipant[];
  lastMessage: ChannelSummaryLastMessage | null;
  /** Newest message time, or the channel's creation time when it has none. */
  lastActivityAt: number;
  /** AI messages (public and whispers) after the read marker; exact count. */
  unreadCount: number;
}

/** Preview text is cut in SQL so a long message never crosses IPC whole. */
export const CHANNEL_PREVIEW_MAX_CHARS = 120;

/** The chat list shows counts above this as "99+". */
export const UNREAD_COUNT_DISPLAY_MAX = 99;
