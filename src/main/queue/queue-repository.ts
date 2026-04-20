/**
 * QueueRepository — thin data-access layer over the `queue_items` table
 * introduced in migration 007-queue.
 *
 * Responsibilities:
 *   - Map SQL snake_case columns to the shared camelCase {@link QueueItem}
 *     shape (`src/shared/queue-types.ts`). All timestamps are epoch-ms
 *     numbers; `target_channel_id`, `started_meeting_id`, `started_at`,
 *     `finished_at`, and `last_error` round-trip as `null`.
 *   - Expose CRUD primitives the {@link QueueService} composes. No
 *     business rules live here (UUID generation, order-index spacing,
 *     event emission, error translation — all upstream).
 *
 * Order-index strategy:
 *   The queue uses a "sparse" ordering scheme: newly-added items get
 *   `lastOrderIndex + 1000`. Reorder operations respace to
 *   `1000, 2000, 3000, ...`. Migration 007 deliberately does NOT place
 *   a UNIQUE constraint on `order_index` — in-flight reorder SQL writes
 *   the same index to two rows momentarily, which we step through in a
 *   transaction. The sparse gaps mean most future inserts never need a
 *   full resequence.
 *
 * Transaction surface:
 *   `transaction(fn)` exposes better-sqlite3's synchronous transaction
 *   primitive. The service composes reorder + claimNext in one
 *   transaction each. See `message-repository.ts` header for the broader
 *   pattern.
 *
 * Active-queue singleton (app-level invariant):
 *   Migration 007 permits multiple `status='in_progress'` rows per
 *   project at the SQL layer — concurrent claim is technically possible.
 *   The service wraps `claimNext` in a transaction to make the
 *   SELECT-next + UPDATE-to-in_progress atomic at the SQLite level. App
 *   startup calls `recoverInProgress()` to re-surface any stragglers left
 *   by a crash mid-run (spec §5.2 recovery rule).
 */

import type Database from 'better-sqlite3';
import type { QueueItem, QueueItemStatus } from '../../shared/queue-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface QueueItemRow {
  id: string;
  project_id: string;
  target_channel_id: string | null;
  order_index: number;
  prompt: string;
  status: QueueItemStatus;
  started_meeting_id: string | null;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
  created_at: number;
}

function rowToItem(row: QueueItemRow): QueueItem {
  return {
    id: row.id,
    projectId: row.project_id,
    targetChannelId: row.target_channel_id,
    orderIndex: row.order_index,
    prompt: row.prompt,
    status: row.status,
    startedMeetingId: row.started_meeting_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export class QueueRepository {
  constructor(private readonly database: Database.Database) {}

  /**
   * Expose the underlying better-sqlite3 handle so the service can
   * compose its own multi-statement transactions (claimNext, reorder,
   * pause/resume) without creating a repo method per combination.
   * Read-only getter — repository callers never reassign the handle.
   */
  get db(): Database.Database {
    return this.database;
  }

  /**
   * Runs `fn` inside a better-sqlite3 transaction. Synchronous by design
   * — better-sqlite3 transactions cannot span awaits.
   */
  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)();
  }

  /** Returns the row by id, or `null` when unknown. */
  get(id: string): QueueItem | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id, target_channel_id, order_index, prompt, status,
                started_meeting_id, started_at, finished_at, last_error, created_at
         FROM queue_items WHERE id = ?`,
      )
      .get(id) as QueueItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  /**
   * Returns the largest `order_index` for `projectId`, or `null` when
   * the project has no queue items yet. Called by `add()` to compute the
   * next sparse index.
   */
  lastOrderIndex(projectId: string): number | null {
    const row = this.database
      .prepare(
        `SELECT MAX(order_index) AS max_order_index
         FROM queue_items WHERE project_id = ?`,
      )
      .get(projectId) as { max_order_index: number | null } | undefined;
    return row && row.max_order_index !== null ? row.max_order_index : null;
  }

  /**
   * Returns the next pending item for `projectId` (smallest
   * `order_index`) or `null`. Used inside the `claimNext` transaction.
   *
   * A tie on `order_index` is broken by `created_at` ASC — matches the
   * natural add order when a reorder happens to collapse indices.
   */
  nextPending(projectId: string): QueueItem | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id, target_channel_id, order_index, prompt, status,
                started_meeting_id, started_at, finished_at, last_error, created_at
         FROM queue_items
         WHERE project_id = ? AND status = 'pending'
         ORDER BY order_index ASC, created_at ASC
         LIMIT 1`,
      )
      .get(projectId) as QueueItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  /**
   * Returns all rows (any status) for `projectId` in display order
   * (order_index ASC). Exposed for tests + future UI listing.
   */
  listByProject(projectId: string): QueueItem[] {
    const rows = this.database
      .prepare(
        `SELECT id, project_id, target_channel_id, order_index, prompt, status,
                started_meeting_id, started_at, finished_at, last_error, created_at
         FROM queue_items
         WHERE project_id = ?
         ORDER BY order_index ASC, created_at ASC`,
      )
      .all(projectId) as QueueItemRow[];
    return rows.map(rowToItem);
  }

  /**
   * Returns all currently `in_progress` rows across all projects. Used
   * by `recoverInProgress()` on app startup to revert stragglers.
   */
  listInProgress(): QueueItem[] {
    const rows = this.database
      .prepare(
        `SELECT id, project_id, target_channel_id, order_index, prompt, status,
                started_meeting_id, started_at, finished_at, last_error, created_at
         FROM queue_items
         WHERE status = 'in_progress'`,
      )
      .all() as QueueItemRow[];
    return rows.map(rowToItem);
  }

  /**
   * Inserts a fully-populated queue item. Caller generates `id` (UUID),
   * `orderIndex`, and `createdAt`. FK violations on `project_id` surface
   * as `SQLITE_CONSTRAINT_FOREIGNKEY`; the service translates into
   * {@link ProjectNotFoundError}.
   */
  insert(item: QueueItem): void {
    this.database
      .prepare(
        `INSERT INTO queue_items (
           id, project_id, target_channel_id, order_index, prompt, status,
           started_meeting_id, started_at, finished_at, last_error, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.projectId,
        item.targetChannelId,
        item.orderIndex,
        item.prompt,
        item.status,
        item.startedMeetingId,
        item.startedAt,
        item.finishedAt,
        item.lastError,
        item.createdAt,
      );
  }

  /** Sets `order_index` for a single row. Used inside reorder. */
  setOrder(id: string, orderIndex: number): void {
    this.database
      .prepare(`UPDATE queue_items SET order_index = ? WHERE id = ?`)
      .run(orderIndex, id);
  }

  /**
   * Sets `status` and optionally `started_at`. Used for pending→paused,
   * paused→pending, pending→in_progress (the atomic claim), and
   * recovery in_progress→pending.
   *
   * When `startedAt` is `undefined`, the column is left untouched. Pass
   * `null` explicitly to CLEAR the column (recovery path).
   */
  setStatus(
    id: string,
    status: QueueItemStatus,
    startedAt?: number | null,
  ): boolean {
    if (startedAt === undefined) {
      const result = this.database
        .prepare(`UPDATE queue_items SET status = ? WHERE id = ?`)
        .run(status, id);
      return result.changes > 0;
    }
    const result = this.database
      .prepare(`UPDATE queue_items SET status = ?, started_at = ? WHERE id = ?`)
      .run(status, startedAt, id);
    return result.changes > 0;
  }

  /**
   * Batch status transition scoped by project + current status. Used by
   * `pause()` (pending→paused) and `resume()` (paused→pending). Returns
   * the number of rows affected.
   */
  setStatusByProject(
    projectId: string,
    fromStatus: QueueItemStatus,
    toStatus: QueueItemStatus,
  ): number {
    const result = this.database
      .prepare(
        `UPDATE queue_items SET status = ?
         WHERE project_id = ? AND status = ?`,
      )
      .run(toStatus, projectId, fromStatus);
    return result.changes;
  }

  /**
   * Finalises a queue item: sets status to 'done' or 'failed', records
   * the linked meeting id (nullable — failure before meeting creation),
   * optional last error, and `finished_at`. Returns `true` when a row
   * was actually updated.
   */
  finish(
    id: string,
    status: 'done' | 'failed' | 'cancelled',
    meetingId: string | null,
    lastError: string | null,
    finishedAt: number,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE queue_items
         SET status = ?,
             started_meeting_id = COALESCE(?, started_meeting_id),
             last_error = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(status, meetingId, lastError, finishedAt, id);
    return result.changes > 0;
  }

  /**
   * Bulk-revert any `status='in_progress'` row to `pending`. Used on app
   * startup (spec §5.2 recovery rule). Clears `started_at` so the next
   * claim re-stamps it. Returns the number of rows reverted.
   */
  revertAllInProgressToPending(): number {
    const result = this.database
      .prepare(
        `UPDATE queue_items
         SET status = 'pending', started_at = NULL
         WHERE status = 'in_progress'`,
      )
      .run();
    return result.changes;
  }
}
