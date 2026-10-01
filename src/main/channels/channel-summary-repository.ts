/**
 * ChannelSummaryRepository — the chat list's rows and the read marker
 * (spec 2026-10-01-messenger-redesign.md R4, migration 036).
 *
 * `listSummaries` runs exactly two SQL statements, however many channels
 * exist:
 *   1. {@link ChannelSummaryRepository.SUMMARY_SQL} — every channel the user
 *      sees (the global general channel, projectless chat rooms, DMs), its
 *      newest message and its unread count. Both per-channel parts are
 *      correlated subqueries that SQLite answers from an index:
 *        - newest message: `idx_messages_channel_time (channel_id,
 *          created_at)`, read backwards one entry (rowid breaks ties);
 *        - unread count: `idx_messages_channel_unread (channel_id,
 *          author_kind, role)`, a range scan over `rowid > marker`, so the
 *          cost grows with the unread rows, not the channel's history.
 *   2. {@link PARTICIPANTS_SQL} — room seat snapshots and DM members.
 * The general channel's members are every registered AI (live registry,
 * `channel-service.ts listMembers`), so the caller passes them in.
 *
 * Unread = AI messages (`author_kind = 'member' AND role = 'assistant'`,
 * public rows and whispers) after the marker. Stored notice rows
 * (`role = 'system'`, including member-authored silence notices), the
 * user's own messages and pass rows never count.
 */
import type Database from 'better-sqlite3';

import {
  CHANNEL_PREVIEW_MAX_CHARS,
  type ChannelSummary,
  type ChannelSummaryKind,
  type ChannelSummaryLastMessage,
  type ChannelSummaryNoticeMeta,
  type ChannelSummaryParticipant,
} from '../../shared/channel-summary-types';
import type { MessageAuthorKind, MessageMeta, MessageRole } from '../../shared/message-types';
import { storedWhisperThreadSeq } from './whisper-thread';

interface SummaryRow {
  channel_id: string;
  name: string;
  kind: string;
  created_at: number;
  room_id: string | null;
  archived_at: number | null;
  unread: number;
  last_id: string | null;
  author_id: string | null;
  author_kind: MessageAuthorKind | null;
  role: MessageRole | null;
  preview: string | null;
  meta_json: string | null;
  last_created_at: number | null;
  visibility: 'public' | 'whisper' | null;
  whisper_sender_name: string | null;
  whisper_recipient_name: string | null;
  whisper_reply_to_message_id: string | null;
  whisper_thread_seq: number | null;
}

interface ParticipantRow {
  channel_id: string;
  provider_id: string;
  display_name: string;
}

const PARTICIPANTS_SQL = `
  SELECT rm.channel_id, rm.provider_id, rm.display_name, rm.sort_order AS seat
    FROM chat_room_members rm
  UNION ALL
  SELECT cm.channel_id, cm.provider_id, p.display_name, 0 AS seat
    FROM channel_members cm
    JOIN channels c ON c.id = cm.channel_id AND c.kind = 'dm' AND c.project_id IS NULL
    JOIN providers p ON p.id = cm.provider_id
  ORDER BY 1, 4`;

const NOTICE_META_KEYS = ['chatError', 'chatErrorDetail', 'chatSilence', 'chatPass'] as const;

function summaryKind(row: SummaryRow): ChannelSummaryKind {
  if (row.kind === 'system_general') return 'general';
  if (row.kind === 'dm') return 'dm';
  if (row.room_id !== null) return 'room';
  throw new Error(`Channel ${row.channel_id} of kind ${row.kind} is not a chat list channel`);
}

function noticeMeta(metaJson: string | null): ChannelSummaryNoticeMeta | null {
  if (metaJson === null) return null;
  // The service always writes meta through JSON.stringify; a parse failure
  // is corrupt data worth surfacing, as in message-repository.ts.
  const meta = JSON.parse(metaJson) as MessageMeta;
  const picked: Record<string, unknown> = {};
  for (const key of NOTICE_META_KEYS) {
    if (meta[key] !== undefined && meta[key] !== null) picked[key] = meta[key];
  }
  return Object.keys(picked).length > 0 ? (picked as ChannelSummaryNoticeMeta) : null;
}

function lastMessage(row: SummaryRow): ChannelSummaryLastMessage | null {
  if (row.last_id === null || row.author_id === null || row.author_kind === null ||
    row.role === null || row.last_created_at === null || row.visibility === null) return null;
  const whisper = row.visibility === 'whisper';
  return {
    id: row.last_id,
    authorId: row.author_id,
    authorKind: row.author_kind,
    role: row.role,
    createdAt: row.last_created_at,
    visibility: row.visibility,
    content: whisper ? null : row.preview,
    notice: whisper ? null : noticeMeta(row.meta_json),
    whisper: whisper ? {
      senderName: row.whisper_sender_name ?? '',
      recipientName: row.whisper_recipient_name ?? '',
      threadSeq: storedWhisperThreadSeq(row.last_id, row.whisper_thread_seq),
      isReply: row.whisper_reply_to_message_id !== null,
    } : null,
  };
}

export class ChannelSummaryRepository {
  /** Statement 1 of {@link listSummaries}; exposed for the query-plan test. */
  static readonly SUMMARY_SQL = `
    WITH visible AS (
      SELECT c.id, c.name, c.kind, c.created_at, r.channel_id AS room_id, r.archived_at
        FROM channels c
        LEFT JOIN chat_rooms r ON r.channel_id = c.id
       WHERE c.project_id IS NULL
         AND (c.kind IN ('system_general', 'dm') OR r.channel_id IS NOT NULL)
    )
    SELECT v.id AS channel_id, v.name, v.kind, v.created_at, v.room_id, v.archived_at,
           (SELECT COUNT(*) FROM messages u
             WHERE u.channel_id = v.id AND u.author_kind = 'member' AND u.role = 'assistant'
               AND u.rowid > COALESCE(rs.last_read_rowid, 0)) AS unread,
           m.id AS last_id, m.author_id, m.author_kind, m.role,
           CASE WHEN m.visibility = 'whisper' THEN NULL
                ELSE substr(m.content, 1, ${CHANNEL_PREVIEW_MAX_CHARS}) END AS preview,
           CASE WHEN m.visibility = 'whisper' THEN NULL ELSE m.meta_json END AS meta_json,
           m.created_at AS last_created_at, m.visibility,
           m.whisper_sender_name, m.whisper_recipient_name,
           m.whisper_reply_to_message_id, m.whisper_thread_seq
      FROM visible v
      LEFT JOIN channel_read_state rs ON rs.channel_id = v.id
      LEFT JOIN messages m ON m.rowid = (
        SELECT x.rowid FROM messages x
         WHERE x.channel_id = v.id
         ORDER BY x.created_at DESC, x.rowid DESC
         LIMIT 1)`;

  constructor(private readonly db: Database.Database) {}

  listSummaries(generalParticipants: readonly ChannelSummaryParticipant[]): ChannelSummary[] {
    const rows = this.db.prepare(ChannelSummaryRepository.SUMMARY_SQL).all() as SummaryRow[];
    const seats = new Map<string, ChannelSummaryParticipant[]>();
    for (const row of this.db.prepare(PARTICIPANTS_SQL).all() as ParticipantRow[]) {
      const list = seats.get(row.channel_id) ?? [];
      list.push({ providerId: row.provider_id, displayName: row.display_name });
      seats.set(row.channel_id, list);
    }
    return rows.map((row) => {
      const kind = summaryKind(row);
      const last = lastMessage(row);
      return {
        channelId: row.channel_id,
        kind,
        name: row.name,
        archivedAt: kind === 'room' ? row.archived_at : null,
        participants: kind === 'general' ? [...generalParticipants] : seats.get(row.channel_id) ?? [],
        lastMessage: last,
        lastActivityAt: last?.createdAt ?? row.created_at,
        unreadCount: row.unread,
      };
    });
  }

  /**
   * Moves the channel's marker up to `messageId` (never back). The message
   * must be in that channel.
   */
  markRead(channelId: string, messageId: string): void {
    const result = this.db.prepare(`
      INSERT INTO channel_read_state (channel_id, last_read_rowid)
      SELECT m.channel_id, m.rowid FROM messages m WHERE m.id = ? AND m.channel_id = ?
      ON CONFLICT(channel_id) DO UPDATE
        SET last_read_rowid = MAX(last_read_rowid, excluded.last_read_rowid)`)
      .run(messageId, channelId);
    if (result.changes === 0) {
      throw new Error(`Message ${messageId} not found in channel ${channelId}`);
    }
  }
}
