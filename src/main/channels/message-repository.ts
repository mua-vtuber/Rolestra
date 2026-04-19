/**
 * MessageRepository — thin data-access layer over the `messages` table and
 * its companion `messages_fts` virtual table, both introduced in migration
 * 005-messages.
 *
 * Responsibilities:
 *   - Map SQL snake_case columns to the shared camelCase `Message` and
 *     `MessageSearchResult` interfaces (`src/shared/message-types.ts`).
 *   - Round-trip `MessageMeta` through the `meta_json` column. `null`
 *     values preserve as-is on both write and read paths.
 *   - Expose INSERT / list / search primitives the {@link MessageService}
 *     composes. No event emission or business rules live here.
 *
 * FTS5 semantics — `rank` / `bm25` sign convention:
 *   The project sticks with `bm25(messages_fts)` (explicit call) rather
 *   than the virtual `rank` column. SQLite's `bm25()` returns NEGATIVE
 *   doubles where **more negative ⇒ better match**. That is, the ordering
 *   "most relevant first" is `ORDER BY bm25(messages_fts) ASC` (ascending
 *   on the negative number is "smaller ⇒ better"). This matches the
 *   comment on `MessageSearchResult.rank` in shared/message-types.ts
 *   ("작을수록 정밀, bm25 음수값"). Do not mix the two conventions — the
 *   repository is the only place the ordering clause is written.
 *
 * FTS5 triggers (see 005-messages.ts) keep `messages_fts` in sync with
 * base-table writes. The repository therefore NEVER writes to
 * `messages_fts` directly — that would double-index the row.
 *
 * Error surfaces:
 *   - The author-kind trigger (`messages_author_fk_check`) fires as a
 *     `SQLITE_CONSTRAINT_TRIGGER` and surfaces through `insert()`. The
 *     service layer is responsible for translating into a friendly
 *     `AuthorTriggerError`.
 *   - Malformed FTS5 `MATCH` queries surface as `SQLITE_ERROR` from
 *     `search()`. The service wraps them as `InvalidQueryError`.
 */

import type Database from 'better-sqlite3';
import type {
  Message,
  MessageAuthorKind,
  MessageMeta,
  MessageRole,
  MessageSearchResult,
} from '../../shared/message-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface MessageRow {
  id: string;
  channel_id: string;
  meeting_id: string | null;
  author_id: string;
  author_kind: MessageAuthorKind;
  role: MessageRole;
  content: string;
  meta_json: string | null;
  created_at: number;
}

/** Row shape for the search query that joins `bm25()` as `rank`. */
interface MessageSearchRow extends MessageRow {
  rank: number;
}

function parseMeta(raw: string | null): MessageMeta | null {
  if (raw === null) return null;
  // Triggers or manual inserts could put malformed JSON here, but migration
  // 005 has no default and the service always writes via JSON.stringify, so
  // a parse failure is a bug worth surfacing loudly.
  return JSON.parse(raw) as MessageMeta;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    meetingId: row.meeting_id,
    authorId: row.author_id,
    authorKind: row.author_kind,
    role: row.role,
    content: row.content,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
  };
}

function rowToSearchResult(row: MessageSearchRow): MessageSearchResult {
  return { ...rowToMessage(row), rank: row.rank };
}

/** Maximum rows either list/search will ever return. Matches the spec's UX cap. */
export const MESSAGE_LIST_MAX_LIMIT = 200;
export const MESSAGE_LIST_DEFAULT_LIMIT = 50;
export const MESSAGE_SEARCH_MAX_LIMIT = 100;
export const MESSAGE_SEARCH_DEFAULT_LIMIT = 30;

export interface ListByChannelOptions {
  /** Maximum rows to return. Clamped to `[1, MESSAGE_LIST_MAX_LIMIT]`. */
  limit?: number;
  /** Optional `createdAt` upper bound (exclusive). Newest-first cursor. */
  before?: number;
}

export interface SearchOptions {
  channelId?: string;
  projectId?: string;
  /** Maximum rows to return. Clamped to `[1, MESSAGE_SEARCH_MAX_LIMIT]`. */
  limit?: number;
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Inserts a fully-populated message row. Caller is responsible for
   * generating `id` (UUID) and `createdAt` (epoch ms). `meta` is
   * serialised to JSON; `null` is stored as SQL NULL.
   *
   * The three `messages_fts_*` triggers auto-sync the FTS index — this
   * function does NOT touch `messages_fts` directly.
   */
  insert(message: Message): void {
    this.db
      .prepare(
        `INSERT INTO messages (
           id, channel_id, meeting_id, author_id, author_kind, role,
           content, meta_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.channelId,
        message.meetingId,
        message.authorId,
        message.authorKind,
        message.role,
        message.content,
        message.meta === null ? null : JSON.stringify(message.meta),
        message.createdAt,
      );
  }

  /** Returns the message by UUID, or `null` when unknown. */
  get(id: string): Message | null {
    const row = this.db
      .prepare(
        `SELECT id, channel_id, meeting_id, author_id, author_kind, role,
                content, meta_json, created_at
         FROM messages WHERE id = ?`,
      )
      .get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  /**
   * Lists messages in a channel newest-first. `before` is an exclusive
   * upper bound on `created_at`, used as a cursor for infinite scroll.
   * `limit` is clamped to `[1, MESSAGE_LIST_MAX_LIMIT]`.
   */
  listByChannel(channelId: string, opts: ListByChannelOptions = {}): Message[] {
    const limit = clampLimit(
      opts.limit,
      MESSAGE_LIST_DEFAULT_LIMIT,
      MESSAGE_LIST_MAX_LIMIT,
    );

    // `created_at` is not monotonic across rows inserted in the same ms,
    // so we add `rowid DESC` as a deterministic tiebreaker (rowid is
    // AUTOINCREMENT in migration 005, so it strictly increases).
    if (opts.before !== undefined) {
      const rows = this.db
        .prepare(
          `SELECT id, channel_id, meeting_id, author_id, author_kind, role,
                  content, meta_json, created_at
           FROM messages
           WHERE channel_id = ? AND created_at < ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
        )
        .all(channelId, opts.before, limit) as MessageRow[];
      return rows.map(rowToMessage);
    }

    const rows = this.db
      .prepare(
        `SELECT id, channel_id, meeting_id, author_id, author_kind, role,
                content, meta_json, created_at
         FROM messages
         WHERE channel_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(channelId, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Full-text searches messages via FTS5 `MATCH`. See the file header for
   * the bm25 sign convention.
   *
   * Scope filters:
   *   - `channelId` only      → `m.channel_id = ?`
   *   - `projectId` only      → JOIN `channels` and filter `c.project_id = ?`
   *   - neither               → global search
   *
   * Callers of the service layer guarantee `channelId` and `projectId`
   * are mutually exclusive; the repository does not re-check.
   *
   * The FTS5 query is passed verbatim to SQLite so callers can use the
   * full FTS5 syntax (quoted phrases, AND/OR/NOT, `foo*` prefix, column
   * filters). Syntax errors surface as `SQLITE_ERROR` and are translated
   * to `InvalidQueryError` by the service.
   */
  search(query: string, opts: SearchOptions = {}): MessageSearchResult[] {
    const limit = clampLimit(
      opts.limit,
      MESSAGE_SEARCH_DEFAULT_LIMIT,
      MESSAGE_SEARCH_MAX_LIMIT,
    );

    // Channel scope — single JOIN, index on `messages(channel_id, ...)`.
    if (opts.channelId !== undefined) {
      const rows = this.db
        .prepare(
          `SELECT m.id, m.channel_id, m.meeting_id, m.author_id, m.author_kind,
                  m.role, m.content, m.meta_json, m.created_at,
                  bm25(messages_fts) AS rank
           FROM messages m
           JOIN messages_fts ON m.rowid = messages_fts.rowid
           WHERE messages_fts MATCH ?
             AND m.channel_id = ?
           ORDER BY rank ASC
           LIMIT ?`,
        )
        .all(query, opts.channelId, limit) as MessageSearchRow[];
      return rows.map(rowToSearchResult);
    }

    // Project scope — join `channels` so we can filter by `project_id`.
    if (opts.projectId !== undefined) {
      const rows = this.db
        .prepare(
          `SELECT m.id, m.channel_id, m.meeting_id, m.author_id, m.author_kind,
                  m.role, m.content, m.meta_json, m.created_at,
                  bm25(messages_fts) AS rank
           FROM messages m
           JOIN messages_fts ON m.rowid = messages_fts.rowid
           JOIN channels c ON m.channel_id = c.id
           WHERE messages_fts MATCH ?
             AND c.project_id = ?
           ORDER BY rank ASC
           LIMIT ?`,
        )
        .all(query, opts.projectId, limit) as MessageSearchRow[];
      return rows.map(rowToSearchResult);
    }

    // Global search — no scope filter.
    const rows = this.db
      .prepare(
        `SELECT m.id, m.channel_id, m.meeting_id, m.author_id, m.author_kind,
                m.role, m.content, m.meta_json, m.created_at,
                bm25(messages_fts) AS rank
         FROM messages m
         JOIN messages_fts ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(query, limit) as MessageSearchRow[];
    return rows.map(rowToSearchResult);
  }
}

/**
 * Clamps an optional user-supplied limit to `[1, max]`, falling back to
 * `defaultValue` when the caller omits it. Centralised so both list and
 * search share the exact same semantics (non-integer / negative /
 * oversized values all collapse to a safe number).
 */
function clampLimit(
  raw: number | undefined,
  defaultValue: number,
  max: number,
): number {
  if (raw === undefined) return defaultValue;
  if (!Number.isFinite(raw)) return defaultValue;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}
