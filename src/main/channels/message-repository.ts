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
  RecentMessage,
} from '../../shared/message-types';
import type { MessageSearchHit } from '../../shared/message-search-types';
import {
  MESSAGE_SEARCH_SNIPPET_CONTEXT,
} from '../../shared/message-search-types';
import { RECENT_MESSAGE_EXCERPT_LEN } from '../../shared/constants';

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

/** Row shape for `searchWithContext` — adds snippet + channel/project names. */
interface MessageSearchHitRow extends MessageSearchRow {
  snippet: string;
  channel_name: string;
  project_name: string | null;
}

function rowToSearchHit(row: MessageSearchHitRow): MessageSearchHit {
  return {
    ...rowToSearchResult(row),
    snippet: row.snippet,
    channelName: row.channel_name,
    projectName: row.project_name,
  };
}

/** Maximum rows either list/search will ever return. Matches the spec's UX cap. */
export const MESSAGE_LIST_MAX_LIMIT = 200;
export const MESSAGE_LIST_DEFAULT_LIMIT = 50;
export const MESSAGE_SEARCH_MAX_LIMIT = 100;
export const MESSAGE_SEARCH_DEFAULT_LIMIT = 30;

/** R4 dashboard RecentWidget — limits for `listRecent`. */
export const RECENT_MESSAGE_DEFAULT_LIMIT = 10;
export const RECENT_MESSAGE_MAX_LIMIT = 50;

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
   * R12-C T9 — 채널의 모든 메시지를 oldest-first 로 반환. archive dump
   * 용도. listByChannel 의 newest-first 페이지네이션과 분리한다.
   */
  listAllByChannel(channelId: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT id, channel_id, meeting_id, author_id, author_kind, role,
                content, meta_json, created_at
         FROM messages
         WHERE channel_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(channelId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * R12-C T9 — 채널의 모든 메시지를 삭제. archive dump 후 호출. FTS5
   * 트리거가 messages_fts 도 동시에 정리한다 (migration 005 트리거).
   * @returns 삭제된 row 수.
   */
  deleteByChannel(channelId: string): number {
    const result = this.db
      .prepare('DELETE FROM messages WHERE channel_id = ?')
      .run(channelId);
    return Number(result.changes ?? 0);
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

  /**
   * R10-Task2: `search()` 확장판 — JOIN 으로 channel 이름 / project 이름을
   * 가져오고, FTS5 `snippet()` 로 `<mark>` 가 삽입된 짧은 문맥을 함께 반환한다.
   *
   * `snippet()` 인수 요약:
   *   - column_idx=0 → `messages_fts.content` 단일 컬럼 인덱스.
   *   - start_tag=`<mark>` / end_tag=`</mark>` → UI 가 CSS 로 하이라이트.
   *   - ellipsis=`…` → 잘린 경우 양 끝 표시.
   *   - tokens=MESSAGE_SEARCH_SNIPPET_CONTEXT → 매치 양쪽 토큰 수.
   *
   * LEFT JOIN projects 를 쓰는 이유: DM 채널(project_id IS NULL)도 검색 결과에
   * 섞일 수 있다. DM 의 경우 project_name=null 이 내려가고 UI 가 "DM" 라벨을
   * 대신 보인다.
   */
  searchWithContext(
    query: string,
    opts: SearchOptions = {},
  ): MessageSearchHit[] {
    const limit = clampLimit(
      opts.limit,
      MESSAGE_SEARCH_DEFAULT_LIMIT,
      MESSAGE_SEARCH_MAX_LIMIT,
    );
    const snippetCtx = MESSAGE_SEARCH_SNIPPET_CONTEXT;

    const projection = `
      SELECT m.id, m.channel_id, m.meeting_id, m.author_id, m.author_kind,
             m.role, m.content, m.meta_json, m.created_at,
             bm25(messages_fts) AS rank,
             snippet(messages_fts, 0, '<mark>', '</mark>', '…', ${snippetCtx}) AS snippet,
             c.name AS channel_name,
             p.name AS project_name
    `;
    const joins = `
      FROM messages m
      JOIN messages_fts ON m.rowid = messages_fts.rowid
      JOIN channels c ON m.channel_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
    `;

    if (opts.channelId !== undefined) {
      const rows = this.db
        .prepare(
          `${projection} ${joins}
           WHERE messages_fts MATCH ?
             AND m.channel_id = ?
           ORDER BY rank ASC
           LIMIT ?`,
        )
        .all(query, opts.channelId, limit) as MessageSearchHitRow[];
      return rows.map(rowToSearchHit);
    }

    if (opts.projectId !== undefined) {
      const rows = this.db
        .prepare(
          `${projection} ${joins}
           WHERE messages_fts MATCH ?
             AND c.project_id = ?
           ORDER BY rank ASC
           LIMIT ?`,
        )
        .all(query, opts.projectId, limit) as MessageSearchHitRow[];
      return rows.map(rowToSearchHit);
    }

    const rows = this.db
      .prepare(
        `${projection} ${joins}
         WHERE messages_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(query, limit) as MessageSearchHitRow[];
    return rows.map(rowToSearchHit);
  }

  /**
   * Returns the last N messages across all channels for the R4 dashboard
   * RecentWidget (spec §7.5). Joins `messages` with `channels` (for the
   * channel name) and LEFT-joins `providers` (for the member sender's
   * `display_name`). Content is truncated to `RECENT_MESSAGE_EXCERPT_LEN`
   * at the SQL layer via `substr` so we don't ship multi-kB rows across
   * IPC for a sidebar widget; an ellipsis is appended in JS when the
   * original message exceeded the cap.
   *
   * Author label rules:
   *   - `author_kind='user'`   → label is the literal `'user'` (the
   *     renderer maps this to a localized "Me"/"나" string — we do not
   *     i18n at the repository boundary).
   *   - `author_kind='member'` → label is `providers.display_name`. If
   *     the provider row is missing (defensive — FK is conditional via
   *     the `messages_author_fk_check` trigger, not the schema), the
   *     raw `author_id` falls back as the label.
   *   - `author_kind='system'` → label is the literal `'system'`; again
   *     the renderer chooses the user-facing string.
   *
   * Ordering: `created_at DESC, rowid DESC` — same tiebreaker as
   * `listByChannel` so duplicate-millisecond rows stay deterministic.
   */
  listRecent(
    limit: number = RECENT_MESSAGE_DEFAULT_LIMIT,
  ): RecentMessage[] {
    const clamped = clampLimit(
      limit,
      RECENT_MESSAGE_DEFAULT_LIMIT,
      RECENT_MESSAGE_MAX_LIMIT,
    );
    interface RecentRow {
      id: string;
      channel_id: string;
      channel_name: string;
      author_id: string;
      author_kind: MessageAuthorKind;
      sender_display: string | null;
      full_len: number;
      excerpt: string;
      created_at: number;
    }
    // `substr(content, 1, N+1)` + `length(content)` so we can detect
    // whether truncation happened without reading the full blob back.
    // N+1 lets us distinguish "exactly N chars" from "more than N chars"
    // when we format the ellipsis in JS.
    const rows = this.db
      .prepare(
        `SELECT m.id AS id,
                m.channel_id AS channel_id,
                c.name AS channel_name,
                m.author_id AS author_id,
                m.author_kind AS author_kind,
                p.display_name AS sender_display,
                length(m.content) AS full_len,
                substr(m.content, 1, ?) AS excerpt,
                m.created_at AS created_at
         FROM messages m
         JOIN channels c ON m.channel_id = c.id
         LEFT JOIN providers p
           ON m.author_kind = 'member' AND m.author_id = p.id
         ORDER BY m.created_at DESC, m.rowid DESC
         LIMIT ?`,
      )
      .all(RECENT_MESSAGE_EXCERPT_LEN + 1, clamped) as RecentRow[];

    return rows.map((row) => {
      const truncated = row.full_len > RECENT_MESSAGE_EXCERPT_LEN;
      const excerpt = truncated
        ? row.excerpt.slice(0, RECENT_MESSAGE_EXCERPT_LEN) + '\u2026'
        : row.excerpt;
      let senderLabel: string;
      if (row.author_kind === 'user') {
        senderLabel = 'user';
      } else if (row.author_kind === 'member') {
        senderLabel = row.sender_display ?? row.author_id;
      } else {
        senderLabel = 'system';
      }
      return {
        id: row.id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        senderId: row.author_id,
        senderKind: row.author_kind,
        senderLabel,
        excerpt,
        createdAt: row.created_at,
      };
    });
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
