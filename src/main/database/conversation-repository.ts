/**
 * Conversation repository — DB CRUD for conversations and messages.
 *
 * Uses prepared statements with better-sqlite3 for all operations.
 * Follows the same pattern as RecoveryManager.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ConversationSummary, ChatMessageData } from '../../shared/engine-types';

/** Shape for inserting a message row. */
export interface MessageInsert {
  id?: string;
  conversationId: string;
  participantId: string;
  participantName: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  responseTimeMs?: number;
  tokenCount?: number;
  branchId?: string;
  parentMessageId?: string;
}

export class ConversationRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Insert a new conversation row. */
  createConversation(
    id: string,
    title: string,
    mode: string,
    participantsJson: string,
  ): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO conversations (id, title, mode, participants, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(id, title, mode, participantsJson);
  }

  /** Update the conversation title. */
  updateTitle(id: string, title: string): void {
    this.db.prepare(
      `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(title, id);
  }

  /** Touch updated_at timestamp. */
  touchTimestamp(id: string): void {
    this.db.prepare(
      `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(id);
  }

  /** Delete a conversation and all its messages (cascade). */
  deleteConversation(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    });
    tx();
  }

  /** Insert a single message row (INSERT OR IGNORE for idempotency). */
  insertMessage(msg: MessageInsert): void {
    const id = msg.id ?? randomUUID();
    this.db.prepare(
      `INSERT OR IGNORE INTO messages
         (id, conversation_id, participant_id, content, role, response_time_ms, token_count, branch_id, parent_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run(
      id,
      msg.conversationId,
      msg.participantId,
      msg.content,
      msg.role,
      msg.responseTimeMs ?? null,
      msg.tokenCount ?? null,
      msg.branchId ?? 'main',
      msg.parentMessageId ?? null,
    );
  }

  /** Get all messages for a conversation, ordered by creation time. */
  getMessages(conversationId: string): ChatMessageData[] {
    const rows = this.db.prepare(
      `SELECT id, role, content, participant_id, response_time_ms, token_count, created_at, branch_id
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    ).all(conversationId) as Array<{
      id: string;
      role: string;
      content: string;
      participant_id: string;
      response_time_ms: number | null;
      token_count: number | null;
      created_at: string;
      branch_id: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      participantId: r.participant_id,
      participantName: r.participant_id === 'user' ? 'User' : r.participant_id,
      responseTimeMs: r.response_time_ms ?? undefined,
      tokenCount: r.token_count ?? undefined,
      createdAt: r.created_at,
      branchId: r.branch_id ?? undefined,
    }));
  }

  /** List conversations with message count, ordered by most recent. */
  listConversations(limit = 50, offset = 0): ConversationSummary[] {
    const rows = this.db.prepare(
      `SELECT c.id, c.title, c.participants, c.created_at, c.updated_at,
              COUNT(m.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Array<{
      id: string;
      title: string | null;
      participants: string;
      created_at: string;
      updated_at: string;
      message_count: number;
    }>;

    return rows.map((r) => {
      let participantNames: string[] = [];
      try {
        const parsed = JSON.parse(r.participants) as Array<{ displayName?: string }>;
        participantNames = parsed.map((p) => p.displayName ?? 'AI');
      } catch { /* ignore parse errors */ }

      return {
        id: r.id,
        title: r.title ?? '',
        participantNames,
        messageCount: r.message_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /** Generate a title from the first user message content (truncate to 40 chars). */
  generateTitle(content: string): string {
    const trimmed = content.trim().replace(/\n/g, ' ');
    if (trimmed.length <= 40) return trimmed;
    return trimmed.slice(0, 37) + '...';
  }
}
