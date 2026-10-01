import type Database from 'better-sqlite3';
import type { Message } from '../../shared/message-types';
import { messageAudienceSql, messageVisibilitySql } from './message-visibility';
import { storedWhisperThreadSeq } from './whisper-thread';

export interface ChatSessionCheckpoint {
  channelId: string;
  providerId: string;
  sessionId: string;
  contextFingerprint: string;
  /** Latest input shown to this provider, excluding its own generated reply. */
  lastMessageId: string | null;
}

interface CheckpointRow {
  channel_id: string;
  provider_id: string;
  session_id: string;
  context_fingerprint: string;
  last_message_id: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  meeting_id: string | null;
  author_id: string;
  author_kind: Message['authorKind'];
  role: Message['role'];
  content: string;
  meta_json: string | null;
  created_at: number;
  visibility: 'public' | 'whisper';
  whisper_recipient_id: string | null;
  whisper_sender_name: string | null;
  whisper_recipient_name: string | null;
  whisper_source_message_id: string | null;
  whisper_reply_to_message_id: string | null;
  whisper_thread_seq: number | null;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id, channelId: row.channel_id, meetingId: row.meeting_id,
    authorId: row.author_id, authorKind: row.author_kind, role: row.role,
    content: row.content,
    meta: row.meta_json === null ? null : JSON.parse(row.meta_json) as Message['meta'],
    createdAt: row.created_at, visibility: row.visibility,
    ...(row.visibility === 'whisper' ? { whisper: {
      recipientId: row.whisper_recipient_id ?? '',
      senderName: row.whisper_sender_name ?? '',
      recipientName: row.whisper_recipient_name ?? '',
      sourceMessageId: row.whisper_source_message_id ?? '',
      replyToMessageId: row.whisper_reply_to_message_id,
      threadSeq: storedWhisperThreadSeq(row.id, row.whisper_thread_seq),
    } } : {}),
  };
}

export interface VisibleMessageSlice {
  messages: Message[];
  lastInputMessageId: string | null;
}

const VISIBLE_ROLES = "('user','assistant','system')";
const MESSAGE_COLUMNS = 'm.*';

/** Durable CLI checkpoint and room-scoped message cursor. No cross-channel reads. */
export class ChatSessionRepository {
  constructor(private readonly db: Database.Database) {}

  load(channelId: string, providerId: string): ChatSessionCheckpoint | null {
    const row = this.db.prepare(`SELECT channel_id, provider_id, session_id,
      context_fingerprint, last_message_id FROM cli_chat_sessions
      WHERE channel_id = ? AND provider_id = ?`)
      .get(channelId, providerId) as CheckpointRow | undefined;
    return row ? {
      channelId: row.channel_id, providerId: row.provider_id,
      sessionId: row.session_id, contextFingerprint: row.context_fingerprint,
      lastMessageId: row.last_message_id,
    } : null;
  }

  /** Delete before invoking a CLI. An interrupted turn must reconstruct. */
  invalidate(channelId: string, providerId: string): void {
    this.db.prepare('DELETE FROM cli_chat_sessions WHERE channel_id = ? AND provider_id = ?')
      .run(channelId, providerId);
  }

  invalidateRoom(channelId: string): void {
    this.db.prepare('DELETE FROM cli_chat_sessions WHERE channel_id = ?').run(channelId);
  }

  save(value: ChatSessionCheckpoint): void {
    this.db.prepare(`INSERT INTO cli_chat_sessions
      (channel_id, provider_id, session_id, context_fingerprint, last_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, provider_id) DO UPDATE SET
        session_id = excluded.session_id,
        context_fingerprint = excluded.context_fingerprint,
        last_message_id = excluded.last_message_id,
        updated_at = excluded.updated_at`)
      .run(value.channelId, value.providerId, value.sessionId,
        value.contextFingerprint, value.lastMessageId, Date.now());
  }

  /** Null means the cursor is missing, hidden from the provider, or belongs to another room. */
  listVisibleAfter(channelId: string, providerId: string, lastMessageId: string): VisibleMessageSlice | null {
    const viewer = { kind: 'provider', providerId } as const;
    const visible = messageVisibilitySql('m', viewer);
    // The cursor only marks a position: one saved on a failure notice resumes too.
    const audience = messageAudienceSql('m', viewer);
    const anchor = this.db.prepare(`SELECT m.rowid FROM messages m
      WHERE m.id = ? AND m.channel_id = ? AND ${audience.predicate}`)
      .get(lastMessageId, channelId, ...audience.params) as { rowid: number } | undefined;
    if (!anchor) return null;
    const rows = this.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m
      WHERE m.channel_id = ? AND m.rowid > ? AND m.role IN ${VISIBLE_ROLES}
        AND ${visible.predicate}
        AND NOT (m.author_id = ? AND m.role = 'assistant')
      ORDER BY m.rowid ASC`)
      .all(channelId, anchor.rowid, ...visible.params, providerId) as MessageRow[];
    return {
      messages: rows.map(toMessage),
      lastInputMessageId: rows.at(-1)?.id ?? lastMessageId,
    };
  }

  /** First turn and missing-session recovery send at most `limit` visible rows. */
  listVisibleRecent(channelId: string, providerId: string, limit: number): VisibleMessageSlice {
    const visible = messageVisibilitySql('m', { kind: 'provider', providerId });
    const rows = this.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m
      WHERE m.channel_id = ? AND m.role IN ${VISIBLE_ROLES} AND ${visible.predicate}
      ORDER BY m.rowid DESC LIMIT ?`)
      .all(channelId, ...visible.params, limit) as MessageRow[];
    rows.reverse();
    return { messages: rows.map(toMessage), lastInputMessageId: rows.at(-1)?.id ?? null };
  }
}
