/**
 * MessageService — append / list / search messages.
 *
 * Responsibilities (spec §7.5 + R2 Task 11):
 *   - `append(input)` inserts a message with a UUID `id` + `createdAt`
 *     timestamp, validates the `user` author literal, and emits a
 *     `'message'` event on the service's EventEmitter. Task 19 will
 *     replace this emitter with the typed stream-bridge; until then the
 *     EventEmitter is the authoritative in-process broadcast.
 *   - `listByChannel(channelId, opts)` — reverse-chronological pagination
 *     bounded by `limit` (default 50, max 200) and an optional `before`
 *     cursor (exclusive `createdAt` upper bound).
 *   - `search(query, scope)` — FTS5 `MATCH` with bm25 ranking. `scope`
 *     admits EITHER `channelId` OR `projectId` (mutually exclusive) OR
 *     neither (global search). Passing both is a programmer error and
 *     surfaces as {@link SearchScopeError}.
 *
 * Defence-in-depth on author identity (spec CB-8):
 *   Two lines of defence enforce the `author_id` invariants — pick your
 *   mental model:
 *     1. Service-layer guard — fails FAST with a friendly
 *        {@link UserAuthorMismatchError} when callers hand us
 *        `authorKind='user'` paired with any `author_id` other than the
 *        literal string `'user'`. Same logic as the DB trigger, minus
 *        the trip through SQLite's error reporting.
 *     2. DB trigger `messages_author_fk_check` (migration 005) —
 *        last-line-defence that fires for BOTH user and member kinds.
 *        The service translates the trigger's `RAISE(ABORT, ...)` into
 *        {@link AuthorTriggerError} so callers get a stable error class
 *        instead of a raw SQLite code.
 *
 *   We rely on the trigger exclusively for the `member` kind because
 *   pre-checking would require a synchronous `providers` lookup per
 *   append — extra round-trip, extra cache invalidation. The trigger
 *   already does the same check under the same transaction, and the
 *   error message it raises is stable text we can match on.
 *
 * Meta round-trip:
 *   `MessageMeta` is persisted as JSON in `messages.meta_json`. `null`
 *   round-trips as `null` on both sides. Any parse failure on read
 *   bubbles as an uncaught JSON.parse error — that would be a bug we
 *   WANT to surface (someone bypassed this service).
 *
 * Transactions:
 *   `append` is a single INSERT — SQLite auto-commits, no explicit
 *   transaction needed. The FTS5 `ai` trigger fires in the same implicit
 *   transaction so the index stays in sync for free.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  USER_AUTHOR_LITERAL as SHARED_USER_AUTHOR_LITERAL,
  type Message,
  type MessageAuthorKind,
  type MessageMeta,
  type MessageRole,
  type MessageSearchResult,
  type RecentMessage,
} from '../../shared/message-types';
import type { MessageSearchHit } from '../../shared/message-search-types';
import { tryGetLogger } from '../log/logger-accessor';
import { MessageRepository } from './message-repository';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — `catch (e instanceof MessageError)` for discrimination. */
export class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageError';
  }
}

/**
 * Raised by `append()` when `authorKind='user'` but `authorId` is not
 * the literal string `'user'`. Mirrors the DB trigger but surfaces as
 * a stable JS class so IPC callers can handle it without string-matching
 * SQLite error messages.
 */
export class UserAuthorMismatchError extends MessageError {
  constructor(authorId: string) {
    super(
      `user author must use literal "user" (got "${authorId}"): ` +
        `authorKind='user' and authorId must match exactly`,
    );
    this.name = 'UserAuthorMismatchError';
  }
}

/**
 * Wrap-around for the `messages_author_fk_check` trigger RAISE. Fires
 * when `authorKind='member'` and `authorId` does not reference
 * `providers.id`. The service does NOT pre-check providers (see header)
 * — the trigger is the source of truth.
 */
export class AuthorTriggerError extends MessageError {
  constructor(authorKind: MessageAuthorKind, authorId: string, cause: string) {
    super(
      `author trigger rejected message (authorKind=${authorKind}, ` +
        `authorId="${authorId}"): ${cause}`,
    );
    this.name = 'AuthorTriggerError';
  }
}

/**
 * Raised by `search()` when both `channelId` and `projectId` are set.
 * Those two scopes are mutually exclusive: `channelId` implies a
 * specific channel, `projectId` implies "all channels in this project".
 * Mixing them would give contradictory signals so we refuse up-front.
 */
export class SearchScopeError extends MessageError {
  constructor() {
    super(
      'search scope: channelId and projectId are mutually exclusive — ' +
        'pass at most one',
    );
    this.name = 'SearchScopeError';
  }
}

/**
 * Raised when SQLite rejects an FTS5 `MATCH` query. Wraps the raw
 * `SQLITE_ERROR` so callers get a stable type to pattern-match on.
 * Preserves the underlying SQLite message as the cause's explanation.
 */
export class InvalidQueryError extends MessageError {
  constructor(query: string, reason: string) {
    super(`invalid FTS5 query "${query}": ${reason}`);
    this.name = 'InvalidQueryError';
  }
}

// ── SQLite error mapping ──────────────────────────────────────────────

interface SqliteErrorLike {
  code?: unknown;
  message?: unknown;
}

function asSqliteErr(err: unknown): SqliteErrorLike | null {
  if (!err || typeof err !== 'object') return null;
  return err as SqliteErrorLike;
}

/**
 * Matches the RAISE(ABORT, ...) emitted by `messages_author_fk_check`
 * in migration 005. better-sqlite3 surfaces trigger aborts with code
 * `SQLITE_CONSTRAINT_TRIGGER` and the RAISE message appended after a
 * colon. We match on the stable message prefix (text inside RAISE) so
 * the translation does not depend on SQLite's internal formatting.
 */
function asAuthorTriggerError(err: unknown): string | null {
  const e = asSqliteErr(err);
  if (!e) return null;
  if (e.code !== 'SQLITE_CONSTRAINT_TRIGGER') return null;
  if (typeof e.message !== 'string') return null;
  // Two RAISE strings in the trigger — either one identifies an author
  // violation. Return the matched phrase so the wrapped error can
  // expose it to the caller.
  const memberPhrase =
    'messages.author_id must reference providers.id when author_kind=member';
  const userPhrase =
    'messages.author_id must be literal "user" when author_kind=user';
  if (e.message.includes(memberPhrase)) return memberPhrase;
  if (e.message.includes(userPhrase)) return userPhrase;
  return null;
}

/**
 * Matches SQLite's generic `SQLITE_ERROR` for a malformed FTS5 query.
 *
 * `SQLITE_ERROR` is SQLite's catch-all code — it fires for column typos,
 * missing tables, malformed SQL, AND malformed FTS5 `MATCH` queries.
 * Matching on the code alone would mis-wrap a developer-caused bug (e.g.
 * a future edit that fat-fingers a column) as `InvalidQueryError` and
 * mislead the caller into blaming the user's query string.
 *
 * To keep the wrapper targeted, we ALSO require the SQLite message text
 * to carry an FTS5-specific signal:
 *   - `fts5:` prefix               — FTS5 module's own error messages
 *   - `syntax error near`          — FTS5 query parser
 *   - `malformed MATCH expression` — SQLite's MATCH validator
 *   - `unterminated string`        — FTS5 parser on an unterminated
 *                                    phrase. Safe to match here because
 *                                    the query arrives as a BOUND
 *                                    parameter (see
 *                                    `message-repository.ts` — every
 *                                    `MATCH ?` uses a placeholder), so
 *                                    this message cannot be produced by
 *                                    a stray SQL-literal typo in our
 *                                    code; it must come from the FTS5
 *                                    query parser processing caller
 *                                    input.
 *
 * When none of those appear, the error bubbles up unwrapped so callers
 * (and tests) see the raw SQLite error — which is what you want for an
 * actual code bug.
 */
function isFtsQueryError(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_ERROR') return false;
  if (typeof e.message !== 'string') return false;
  const msg = e.message;
  return (
    msg.includes('fts5:') ||
    msg.includes('syntax error near') ||
    msg.includes('malformed MATCH expression') ||
    msg.includes('unterminated string')
  );
}

// ── Input shapes ──────────────────────────────────────────────────────

export interface AppendMessageInput {
  channelId: string;
  meetingId?: string | null;
  authorId: string;
  authorKind: MessageAuthorKind;
  role: MessageRole;
  content: string;
  meta?: MessageMeta | null;
}

export interface ListByChannelInput {
  limit?: number;
  /** Exclusive upper bound on `createdAt` (newest-first cursor). */
  before?: number;
}

export interface SearchInput {
  /** Restrict search to a single channel. Mutually exclusive with `projectId`. */
  channelId?: string;
  /** Restrict search to all channels of a project. Mutually exclusive with `channelId`. */
  projectId?: string;
  limit?: number;
}

// ── Event typing ──────────────────────────────────────────────────────

/** Event name emitted on every successful `append()`. */
export const MESSAGE_EVENT = 'message' as const;

/**
 * Typed overlay on `EventEmitter` — callers still use the standard
 * `on`/`off` API but TypeScript checks the event name + listener shape.
 * Task 19 (stream-bridge) will replace this surface with an IPC-aware
 * broadcaster; until then the typed EventEmitter is the broadcast API.
 */
export interface MessageServiceEvents {
  message: (msg: Message) => void;
}

// ── Service ────────────────────────────────────────────────────────────

/**
 * Re-export of the shared author literal (see
 * `shared/message-types.ts`). Kept here so existing main-side imports
 * — `import { USER_AUTHOR_LITERAL } from '../channels/message-service'`
 * — continue to compile without churn.
 */
export const USER_AUTHOR_LITERAL = SHARED_USER_AUTHOR_LITERAL;

export class MessageService extends EventEmitter {
  constructor(private readonly repo: MessageRepository) {
    super();
  }

  /**
   * Append a message to a channel. Generates `id` + `createdAt` for the
   * caller and emits `'message'` with the saved row on success.
   *
   * Validation order (fail-fast on cheap checks first):
   *   1. `authorKind='user'` literal guard (service).
   *   2. Forward to INSERT; DB trigger enforces `member` FK invariant
   *      and also re-enforces (1) as last-line-defence.
   *
   * @throws {UserAuthorMismatchError} `authorKind='user'` but
   *   `authorId !== 'user'`.
   * @throws {AuthorTriggerError}      DB trigger rejected the row
   *   (typically `authorKind='member'` with an unknown `authorId`).
   */
  append(input: AppendMessageInput): Message {
    // (1) Literal guard — cheap, runs before we touch SQLite.
    if (
      input.authorKind === 'user' &&
      input.authorId !== USER_AUTHOR_LITERAL
    ) {
      throw new UserAuthorMismatchError(input.authorId);
    }

    const message: Message = {
      id: randomUUID(),
      channelId: input.channelId,
      meetingId: input.meetingId ?? null,
      authorId: input.authorId,
      authorKind: input.authorKind,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    };

    try {
      this.repo.insert(message);
    } catch (err) {
      const phrase = asAuthorTriggerError(err);
      if (phrase !== null) {
        throw new AuthorTriggerError(
          input.authorKind,
          input.authorId,
          phrase,
        );
      }
      throw err;
    }

    // Dogfooding visibility (R12): a one-line breadcrumb every time a
    // message lands. Lets a dev tail `npm run dev` and confirm "the user
    // typed → IPC fired → row was inserted", separately from the
    // separate question of "did a meeting actually start". `info` keeps
    // it out of warn/error visual noise.
    tryGetLogger()?.info({
      component: 'message',
      action: 'append',
      result: 'success',
      metadata: {
        messageId: message.id,
        channelId: message.channelId,
        meetingId: message.meetingId,
        authorKind: message.authorKind,
        authorId: message.authorId,
        role: message.role,
        contentLength:
          typeof message.content === 'string' ? message.content.length : -1,
      },
    });

    // Emit is strictly a broadcast — listener failures must not rewrite
    // the contract of `append()`, which is "row is saved, you get the
    // Message back". Without this guard, a bad subscriber would propagate
    // its error up the return path and the caller would never see the
    // Message (even though the INSERT committed). We swallow the throw
    // and log it so the listener bug is still observable.
    //
    // This pattern mirrors `shell-env.ts` (Task 7): console.warn with a
    // TODO R2-log marker so the later structured-logger pass picks this
    // site up too.
    try {
      this.emit(MESSAGE_EVENT, message);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      // TODO R2-log: swap for structured logger (src/main/log/)
      console.warn('[rolestra.channels.message] listener threw:', {
        name: err instanceof Error ? err.name : undefined,
        message: errMessage,
      });
    }
    return message;
  }

  /**
   * Lists messages in a channel newest-first. Both parameters are
   * forwarded to the repository verbatim (which clamps `limit`).
   */
  listByChannel(channelId: string, opts: ListByChannelInput = {}): Message[] {
    return this.repo.listByChannel(channelId, opts);
  }

  /**
   * FTS5 search scoped to a channel, a project, or globally. Caller must
   * pass AT MOST ONE of `channelId` / `projectId`; combining the two is
   * programmer error ({@link SearchScopeError}).
   *
   * Query syntax is FTS5 native (quoted phrases, AND/OR/NOT, prefix `*`,
   * column filters). SQLite syntax errors are wrapped as
   * {@link InvalidQueryError}.
   */
  search(query: string, opts: SearchInput = {}): MessageSearchResult[] {
    if (opts.channelId !== undefined && opts.projectId !== undefined) {
      throw new SearchScopeError();
    }

    try {
      return this.repo.search(query, opts);
    } catch (err) {
      if (isFtsQueryError(err)) {
        const msg =
          err instanceof Error ? err.message : String(err);
        throw new InvalidQueryError(query, msg);
      }
      throw err;
    }
  }

  /**
   * R10-Task2: `search()` 와 동일한 scope/limit 규칙을 공유하되, UI 가
   * 한 번에 렌더할 수 있도록 FTS5 snippet + channel/project 이름을 포함한
   * `MessageSearchHit[]` 를 반환한다. `MessageSearchView` 가 이 메서드를
   * 호출하고, `search()` 는 내부 로직(예: SSM 가 "이전 메시지 찾기" 등) 이
   * 유지하는 경량 경로로 남긴다.
   */
  searchWithContext(query: string, opts: SearchInput = {}): MessageSearchHit[] {
    if (opts.channelId !== undefined && opts.projectId !== undefined) {
      throw new SearchScopeError();
    }
    try {
      return this.repo.searchWithContext(query, opts);
    } catch (err) {
      if (isFtsQueryError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new InvalidQueryError(query, msg);
      }
      throw err;
    }
  }

  /**
   * R4 dashboard RecentWidget accessor — last N messages across ALL
   * channels, with channel name + sender label joined at the SQL layer.
   * Delegates to the repository; the limit clamp lives there.
   */
  listRecent(limit?: number): RecentMessage[] {
    return this.repo.listRecent(limit);
  }

  // ── typed EventEmitter overloads ───────────────────────────────────

  on<E extends keyof MessageServiceEvents>(
    event: E,
    listener: MessageServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof MessageServiceEvents>(
    event: E,
    listener: MessageServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof MessageServiceEvents>(
    event: E,
    ...args: Parameters<MessageServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
