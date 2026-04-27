/**
 * Endpoint handler implementations for the remote access HTTP server.
 *
 * Each handler is pure logic — no HTTP concerns. The server calls these
 * methods and wraps the results in HTTP responses.
 */

import type Database from 'better-sqlite3';
import type { RemoteAccessMode } from '../../shared/remote-types';
import { APP_VERSION } from '../../shared/constants';

/** Raw row shape from conversations table. */
interface ConversationRow {
  id: string;
  title: string | null;
  mode: string;
}

/** Raw row shape from messages table. */
interface MessageRow {
  id: string;
  conversation_id: string;
  participant_id: string | null;
  content: string;
  role: string;
  pinned: number;
  pin_topic: string | null;
  response_time_ms: number | null;
  token_count: number | null;
  created_at: string;
  parent_message_id: string | null;
  branch_id: string | null;
  branch_root_message_id: string | null;
}

/** Raw row shape from FTS5 memory search. */
interface MemorySearchRow {
  id: string;
  content: string;
  rank: number;
}

/** Single memory search hit — id, content, normalized BM25 score in [0,1]. */
export interface MemorySearchHit {
  id: string;
  content: string;
  score: number;
}

/**
 * Discriminated response from {@link RemoteHandlers.handleMemorySearch}.
 * Callers must check `ok` before reading either branch — empty query
 * and FTS DB faults both surface as `ok: false` so the caller can show
 * a specific error message instead of conflating "no results" with
 * "search broken".
 */
export type MemorySearchResponse =
  | { ok: true; rows: MemorySearchHit[] }
  | {
      ok: false;
      code: 'EMPTY_QUERY' | 'INVALID_QUERY' | 'FTS_DB_ERROR';
      message: string;
    };

export class RemoteHandlers {
  private readonly db: Database.Database;
  private mode: RemoteAccessMode;

  constructor(db: Database.Database, mode: RemoteAccessMode = 'disabled') {
    this.db = db;
    this.mode = mode;
  }

  /**
   * Updates the current access mode reported by ping.
   */
  setMode(mode: RemoteAccessMode): void {
    this.mode = mode;
  }

  /**
   * Returns the app version and current remote access mode.
   */
  handlePing(): { version: string; mode: RemoteAccessMode } {
    return { version: APP_VERSION, mode: this.mode };
  }

  /**
   * Lists all conversations.
   */
  handleConversationsList(): Array<{ id: string; title: string; mode: string }> {
    const rows = this.db
      .prepare('SELECT id, title, mode FROM conversations ORDER BY updated_at DESC')
      .all() as ConversationRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      mode: row.mode,
    }));
  }

  /**
   * Gets a single conversation with its messages.
   * Returns `null` if the conversation does not exist.
   */
  handleConversationGet(
    conversationId: string,
  ): { id: string; title: string; mode: string; messages: unknown[] } | null {
    const conv = this.db
      .prepare('SELECT id, title, mode FROM conversations WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;

    if (!conv) {
      return null;
    }

    const messages = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      )
      .all(conversationId) as MessageRow[];

    return {
      id: conv.id,
      title: conv.title ?? '',
      mode: conv.mode,
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        participantId: m.participant_id,
        content: m.content,
        role: m.role,
        pinned: m.pinned === 1,
        pinTopic: m.pin_topic,
        responseTimeMs: m.response_time_ms,
        tokenCount: m.token_count,
        createdAt: m.created_at,
        parentMessageId: m.parent_message_id,
        branchId: m.branch_id,
        branchRootMessageId: m.branch_root_message_id,
      })),
    };
  }

  /**
   * Searches knowledge nodes using FTS5 full-text search.
   *
   * Returns matching nodes with their BM25 relevance scores,
   * normalized to [0, 1] range.
   *
   * Failure surfaces:
   * - Empty / whitespace-only query → `{ ok: false, code: 'EMPTY_QUERY' }`
   * - Query escapes to nothing usable → `{ ok: false, code: 'INVALID_QUERY' }`
   * - DB / FTS error → `{ ok: false, code: 'FTS_DB_ERROR' }` with the
   *   underlying message so the caller can show "search is currently
   *   unavailable" instead of "no results", which is misleading.
   */
  handleMemorySearch(query: string, limit = 20): MemorySearchResponse {
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { ok: false, code: 'EMPTY_QUERY', message: 'query must be a non-empty string' };
    }

    const safeQuery = this.escapeFtsQuery(query);
    if (!safeQuery) {
      return {
        ok: false,
        code: 'INVALID_QUERY',
        message: 'query did not contain any searchable tokens',
      };
    }

    let rows: MemorySearchRow[];
    try {
      rows = this.db
        .prepare(
          `SELECT kn.id, kn.content, kf.rank
           FROM knowledge_fts kf
           JOIN knowledge_nodes kn ON kn.rowid = kf.rowid
           WHERE knowledge_fts MATCH ?
             AND kn.deleted_at IS NULL
           ORDER BY kf.rank
           LIMIT ?`,
        )
        .all(safeQuery, limit) as MemorySearchRow[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: 'FTS_DB_ERROR', message };
    }

    if (rows.length === 0) {
      return { ok: true, rows: [] };
    }

    // Normalize FTS5 ranks to [0, 1]. FTS5 rank values are negative
    // (more negative = better match). We invert and normalize.
    const ranks = rows.map((r) => r.rank);
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);
    const rankRange = maxRank - minRank;

    return {
      ok: true,
      rows: rows.map((row) => ({
        id: row.id,
        content: row.content,
        score:
          rankRange !== 0
            ? (maxRank - row.rank) / rankRange
            : 1.0,
      })),
    };
  }

  /**
   * Escapes a user query for safe FTS5 MATCH usage.
   */
  private escapeFtsQuery(query: string): string {
    const words = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, '""')}"`);

    return words.join(' ');
  }
}
