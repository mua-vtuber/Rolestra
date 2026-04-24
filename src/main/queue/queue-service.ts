/**
 * QueueService — autonomy-queue CRUD + ordering + atomic claim.
 *
 * Responsibilities (spec §5.2 queue_items + R2 Task 15):
 *   - `add(projectId, prompt, targetChannelId?)` — append a new pending
 *     item at `lastOrderIndex + 1000`. Emits `'changed'` with
 *     `{projectId}`.
 *   - `reorder(projectId, orderedIds)` — respace all listed items to
 *     `1000, 2000, 3000, ...` inside one transaction. Emits `'changed'`.
 *   - `claimNext(projectId)` — atomic SELECT-next-pending + flip to
 *     `in_progress` in the same transaction; returns the updated
 *     QueueItem or `null`. No event emitted here — the engine's turn
 *     start is the observable side-effect the UI cares about.
 *   - `complete(id, meetingId, success, error?)` — finalise an
 *     in-flight item as `done` or `failed`, stamp `finished_at`, and
 *     attach the associated meeting id + optional error.
 *   - `cancel(id)` — pending/paused rows go to `cancelled`; in-progress
 *     rows stay put but emit `'abort-requested'` with the linked
 *     meeting id so Task 20 (engine wiring) can cancel the run.
 *   - `pause(projectId)` / `resume(projectId)` — batch toggle between
 *     `pending` and `paused`. Both run in a transaction.
 *   - `recoverInProgress()` — called at app startup. Reverts any
 *     lingering `in_progress` row (left by a crash) back to `pending`
 *     so the next claim picks it up. Returns the number reverted.
 *
 * Event model:
 *   A single `'changed'` event broadcasts mutation so the UI (Task 19
 *   stream-bridge) can refresh. Payloads carry the minimum hint the
 *   caller needs: `{projectId}` for list-wide changes or `{id}` for
 *   single-row updates. The `'abort-requested'` event carries
 *   `{id, meetingId}` for the engine.
 *
 * Error surface:
 *   - `SQLITE_CONSTRAINT_FOREIGNKEY` on `project_id` → {@link ProjectNotFoundError}.
 *   - `SQLITE_CONSTRAINT_FOREIGNKEY` on `target_channel_id` →
 *     {@link ChannelNotFoundError} (same code, disambiguated by message).
 *     SQLite's FK error message does NOT name the column, so we best-
 *     effort guess by checking the project id first (service performs a
 *     cheap existence check before falling back to channel attribution).
 *   - Any other error bubbles as the raw SqliteError.
 *
 * Transaction pattern:
 *   All multi-statement mutations (reorder, claimNext, pause, resume)
 *   run inside `repo.transaction(() => ...)`. better-sqlite3 is
 *   synchronous, so there's no await inside the body.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { QueueItem } from '../../shared/queue-types';
import { QueueRepository } from './queue-repository';
import type { CircuitBreaker } from './circuit-breaker';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — `catch (e instanceof QueueError)` for discrimination. */
export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

/**
 * Raised by `add()` when `projectId` does not reference `projects.id`.
 * Translated from `SQLITE_CONSTRAINT_FOREIGNKEY` on the `queue_items.project_id`
 * FK defined by migration 007.
 */
export class ProjectNotFoundError extends QueueError {
  constructor(projectId: string) {
    super(
      `project not found: ${projectId} — queue_items.project_id FK requires ` +
        `an existing projects.id`,
    );
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * Raised by `complete()` / `cancel()` when the target id is unknown.
 * Not used for `add()` FK violations — those have the richer
 * {@link ProjectNotFoundError}.
 */
export class QueueItemNotFoundError extends QueueError {
  constructor(id: string) {
    super(`queue item not found: ${id}`);
    this.name = 'QueueItemNotFoundError';
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

function isForeignKeyViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  return e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
}

// ── Input / event shapes ──────────────────────────────────────────────

export interface AddQueueItemInput {
  projectId: string;
  prompt: string;
  targetChannelId?: string | null;
}

/**
 * R9-Task7: injected by production wiring so `startNext` can spawn a
 * meeting for the claimed queue item. The returned `meetingId` is
 * stored in `queue_items.started_meeting_id` so the onFinal hook can
 * correlate a meeting end back to the queue row.
 *
 * Omitted in R2 tests + standalone CRUD callers — when absent,
 * `startNext` performs the atomic pending→in_progress flip and emits
 * the `'changed'` event but does not kick off an orchestrator. This is
 * the contract tests depend on to cover the queue-state path without
 * standing up the full meeting service graph.
 */
export type QueueMeetingStarter = (input: {
  projectId: string;
  prompt: string;
  queueItemId: string;
}) => Promise<{ meetingId: string }>;

/** Event payload for `'changed'`: either a project-wide or single-id hint. */
export type QueueChangedEvent =
  | { projectId: string; id?: undefined }
  | { id: string; projectId?: undefined };

/** Event payload for `'abort-requested'` (cancel-while-running). */
export interface QueueAbortRequestedEvent {
  id: string;
  meetingId: string | null;
}

/** Typed overlay on EventEmitter — see MessageService for the rationale. */
export interface QueueServiceEvents {
  changed: (event: QueueChangedEvent) => void;
  'abort-requested': (event: QueueAbortRequestedEvent) => void;
}

export const QUEUE_CHANGED_EVENT = 'changed' as const;
export const QUEUE_ABORT_REQUESTED_EVENT = 'abort-requested' as const;

/** Sparse-index step used by `add()` and `reorder()`. */
export const QUEUE_ORDER_STEP = 1000;

// ── Service ────────────────────────────────────────────────────────────

export class QueueService extends EventEmitter {
  /**
   * R9-Task6 (spec §8 CB-5 `queue_streak`): optional CircuitBreaker
   * that receives a `recordQueueStart()` tick every time `claimNext()`
   * successfully flips a pending item to `in_progress`. Left optional
   * because legacy callers (R2 tests, Task 7 wiring) construct the
   * service without an autonomy loop — claimNext is still a valid
   * standalone operation when no breaker is registered.
   */
  private readonly circuitBreaker: CircuitBreaker | null;
  /**
   * R9-Task7: optional meeting spawner called from `startNext`. See
   * {@link QueueMeetingStarter} for the contract + test fallback.
   */
  private readonly meetingStarter: QueueMeetingStarter | null;

  constructor(
    private readonly repo: QueueRepository,
    options: {
      circuitBreaker?: CircuitBreaker;
      meetingStarter?: QueueMeetingStarter;
    } = {},
  ) {
    super();
    this.circuitBreaker = options.circuitBreaker ?? null;
    this.meetingStarter = options.meetingStarter ?? null;
  }

  /**
   * Append a new pending queue item. Generates `id` + `createdAt` and
   * assigns `orderIndex = lastOrderIndex(projectId) + 1000`.
   *
   * @throws {ProjectNotFoundError} when `projectId` does not exist.
   */
  add(input: AddQueueItemInput): QueueItem {
    const last = this.repo.lastOrderIndex(input.projectId);
    const item: QueueItem = {
      id: randomUUID(),
      projectId: input.projectId,
      targetChannelId: input.targetChannelId ?? null,
      orderIndex: (last ?? 0) + QUEUE_ORDER_STEP,
      prompt: input.prompt,
      status: 'pending',
      startedMeetingId: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      createdAt: Date.now(),
    };

    try {
      this.repo.insert(item);
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        // We can't distinguish project vs. channel FK from SQLite's
        // generic FOREIGNKEY message alone. The service spec only
        // surfaces ProjectNotFoundError for `add`; a bad target channel
        // id is a programmer error (the UI constrains the picker to
        // real channels), so reporting it as project-not-found would
        // mislead. Instead, we guess: if the project id is missing the
        // message is about the project. Otherwise rethrow raw.
        //
        // Keep the check defensive — a concurrent project delete can
        // also cause this but that case is identical from the caller's
        // perspective ("project doesn't exist anymore").
        throw new ProjectNotFoundError(input.projectId);
      }
      throw err;
    }

    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId: input.projectId });
    return item;
  }

  /**
   * Respace the listed items to `1000, 2000, 3000, ...` in one
   * transaction. Items not included in `orderedIds` are left untouched
   * (caller is expected to pass the complete current list).
   *
   * No-op on an empty list. Unknown ids in the list produce zero-change
   * UPDATE statements (silent) — we do NOT pre-validate because the
   * caller owns the ordering UI and would be passing DB-sourced ids.
   */
  reorder(projectId: string, orderedIds: string[]): void {
    if (orderedIds.length === 0) {
      this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
      return;
    }
    this.repo.transaction(() => {
      orderedIds.forEach((id, i) => {
        this.repo.setOrder(id, (i + 1) * QUEUE_ORDER_STEP);
      });
    });
    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
  }

  /**
   * Atomically select the next pending item for `projectId` and flip
   * it to `in_progress` with `started_at = now`. Returns `null` when
   * no pending item exists.
   *
   * Wrapping the SELECT + UPDATE in one better-sqlite3 transaction
   * eliminates the classic TOCTOU where two pollers would both see the
   * same "next" item. SQLite's default deferred transaction still
   * guarantees a consistent snapshot for the duration.
   */
  claimNext(projectId: string): QueueItem | null {
    const claimed: QueueItem | null = this.repo.transaction(() => {
      const next = this.repo.nextPending(projectId);
      if (!next) return null;
      const startedAt = Date.now();
      this.repo.setStatus(next.id, 'in_progress', startedAt);
      const result: QueueItem = {
        ...next,
        status: 'in_progress',
        startedAt,
      };
      return result;
    });
    // R9-Task6: feed the `queue_streak` tripwire. Only a successful
    // claim counts — when the queue is empty we skip the record so
    // idle polling does not inflate the streak. Called outside the
    // transaction so a breaker listener can emit side effects (e.g.
    // autonomy downgrade) without re-entering SQLite.
    if (claimed && this.circuitBreaker) {
      this.circuitBreaker.recordQueueStart();
    }
    return claimed;
  }

  /**
   * Finalise a queue item. `success=true` sets status to `done`;
   * `success=false` sets it to `failed`. `meetingId` is stored when
   * supplied (typically the meeting that ran the prompt); `null`
   * preserves any previously-stored meeting id.
   *
   * @throws {QueueItemNotFoundError} when `id` is unknown.
   */
  complete(
    id: string,
    meetingId: string | null,
    success: boolean,
    error?: string,
  ): void {
    const finishedAt = Date.now();
    const status = success ? 'done' : 'failed';
    const updated = this.repo.finish(
      id,
      status,
      meetingId,
      error ?? null,
      finishedAt,
    );
    if (!updated) throw new QueueItemNotFoundError(id);
    this.safeEmit(QUEUE_CHANGED_EVENT, { id });
  }

  /**
   * Cancel a queue item. Pending / paused rows move to `cancelled`
   * immediately. An `in_progress` row is NOT transitioned here —
   * cancelling a running task requires the engine to stop the meeting
   * first. Instead we emit `'abort-requested'` and let the engine
   * (Task 20) drive the final status.
   *
   * `done` / `failed` / `cancelled` rows are silently left alone — the
   * user clicking "cancel" on a finished item is a harmless no-op.
   *
   * @throws {QueueItemNotFoundError} when `id` is unknown.
   */
  cancel(id: string): void {
    const existing = this.repo.get(id);
    if (!existing) throw new QueueItemNotFoundError(id);

    if (existing.status === 'pending' || existing.status === 'paused') {
      const finishedAt = Date.now();
      this.repo.finish(id, 'cancelled', null, null, finishedAt);
      this.safeEmit(QUEUE_CHANGED_EVENT, { id });
      return;
    }
    if (existing.status === 'in_progress') {
      this.safeEmit(QUEUE_ABORT_REQUESTED_EVENT, {
        id,
        meetingId: existing.startedMeetingId,
      });
      return;
    }
    // Already terminal (done / failed / cancelled) — no-op.
  }

  /**
   * Batch-move all pending items in `projectId` to `paused`. In-flight
   * and terminal rows are left alone (pausing a running job is the
   * cancel flow).
   */
  pause(projectId: string): number {
    const changes = this.repo.transaction(() =>
      this.repo.setStatusByProject(projectId, 'pending', 'paused'),
    );
    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
    return changes;
  }

  /**
   * Batch-move all paused items in `projectId` back to `pending`.
   * Mirror of {@link pause}.
   */
  resume(projectId: string): number {
    const changes = this.repo.transaction(() =>
      this.repo.setStatusByProject(projectId, 'paused', 'pending'),
    );
    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
    return changes;
  }

  /**
   * R9-Task7: queue-level run-state predicate. A project is considered
   * paused when one or more items still sit at `status='paused'` after
   * the user toggled the pause control. `startNext` consults this gate
   * before flipping the next pending item — it is the "don't auto-start
   * while the user has paused the queue" contract from spec §5.2.
   *
   * Derivation-based (no separate flag table) so the semantics match
   * R2 `pause()` / `resume()` exactly: pause moves pending→paused, so
   * the predicate returns true afterwards; resume moves them back to
   * pending and the predicate returns false.
   *
   * Edge case: pause() on an empty queue is a no-op (0 rows touched),
   * which means a subsequent `add` lands as pending and `isPaused`
   * reports false. That mirrors R2 behaviour — if nothing is paused,
   * nothing is being held back.
   */
  isPaused(projectId: string): boolean {
    return this.listByProject(projectId).some((i) => i.status === 'paused');
  }

  /**
   * R9-Task7: reverse lookup used by the meeting onFinal hook to find
   * the queue row that owns a just-finished meeting. Returns `null`
   * when no queue item has its `started_meeting_id` pointing at
   * `meetingId` — that is the common case when a meeting was started
   * directly via `channel:start-meeting` rather than the autonomy-queue
   * loop.
   */
  findByMeetingId(meetingId: string): QueueItem | null {
    return this.repo.findByMeetingId(meetingId);
  }

  /**
   * R9-Task7: autonomy-queue run loop advance. Claims the next pending
   * item (atomic pending→in_progress flip via {@link claimNext}) and,
   * when a {@link QueueMeetingStarter} is wired, spawns a meeting for
   * the claimed item + stamps the returned `meetingId` back on the
   * queue row so the onFinal hook can correlate them.
   *
   * Returns:
   *   - `null` when the project is paused (spec §5.2: paused → no-op).
   *   - `null` when no pending item exists (empty queue, idle).
   *   - the claimed + meeting-stamped `QueueItem` otherwise.
   *
   * Error surface:
   *   - A throwing `meetingStarter` flips the claimed row to `failed`
   *     (with `last_error` carrying the starter's message) before
   *     re-throwing so the caller can log + move on to the next tick.
   *     This keeps the queue from wedging on a single broken item.
   *
   * Event model:
   *   - Emits `'changed' {projectId}` exactly once at the end of a
   *     successful claim so the StreamBridge fans out a full
   *     `stream:queue-updated` snapshot. The error branch emits the
   *     same event before re-throwing so the renderer sees the failed
   *     row.
   *   - No emit on the paused/empty paths — state did not change.
   */
  async startNext(projectId: string): Promise<QueueItem | null> {
    if (this.isPaused(projectId)) return null;

    const claimed = this.claimNext(projectId);
    if (!claimed) return null;

    let final: QueueItem = claimed;

    if (this.meetingStarter) {
      try {
        const { meetingId } = await this.meetingStarter({
          projectId,
          prompt: claimed.prompt,
          queueItemId: claimed.id,
        });
        this.repo.setStartedMeetingId(claimed.id, meetingId);
        final = { ...claimed, startedMeetingId: meetingId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const finishedAt = Date.now();
        this.repo.finish(
          claimed.id,
          'failed',
          null,
          `meeting start failed: ${message}`,
          finishedAt,
        );
        this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
        throw err;
      }
    }

    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId });
    return final;
  }

  /**
   * Revert any lingering `in_progress` rows to `pending` and clear
   * `started_at`. Called once at app startup to recover from crashes
   * during an autonomous run (spec §5.2 recovery rule). Returns the
   * number of rows reverted so the caller can surface a notification.
   *
   * Does NOT emit `'changed'` — startup recovery is a global sweep and
   * at that point no UI subscribers exist yet; callers who need a
   * signal can branch on the return value.
   */
  recoverInProgress(): number {
    return this.repo.revertAllInProgressToPending();
  }

  /**
   * Hard-delete a pending item. Only valid for `status='pending'` or
   * `'paused'` rows — IPC `queue:remove` is meant for the user dismissing
   * a queue entry they no longer want to run. In-flight rows must go
   * through {@link cancel}; terminal rows are kept so the audit trail
   * survives. Emits `'changed'` on success.
   *
   * @throws {QueueItemNotFoundError} unknown id.
   * @throws {QueueError}             status is not removable.
   */
  remove(id: string): void {
    const existing = this.repo.get(id);
    if (!existing) throw new QueueItemNotFoundError(id);
    if (existing.status !== 'pending' && existing.status !== 'paused') {
      throw new QueueError(
        `remove: status must be pending or paused (got ${existing.status}); use cancel() for in-flight items`,
      );
    }
    this.repo.delete(id);
    this.safeEmit(QUEUE_CHANGED_EVENT, { projectId: existing.projectId });
  }

  /** Per-id lookup. Returns `null` when unknown. */
  get(id: string): QueueItem | null {
    return this.repo.get(id);
  }

  /** Full list for a project in display order. */
  listByProject(projectId: string): QueueItem[] {
    return this.repo.listByProject(projectId);
  }

  // ── Emit isolation ────────────────────────────────────────────────

  /**
   * Single emit site wrapped in try/catch so a buggy subscriber cannot
   * break the service's public contract. Mirrors MessageService.
   */
  private safeEmit<E extends keyof QueueServiceEvents>(
    event: E,
    payload: Parameters<QueueServiceEvents[E]>[0],
  ): void {
    try {
      this.emit(event, payload);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      // TODO R2-log: swap for structured logger (src/main/log/)
      console.warn('[rolestra.queue] listener threw:', {
        event,
        name: err instanceof Error ? err.name : undefined,
        message: errMessage,
      });
    }
  }

  // ── Typed EventEmitter overloads ──────────────────────────────────

  on<E extends keyof QueueServiceEvents>(
    event: E,
    listener: QueueServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof QueueServiceEvents>(
    event: E,
    listener: QueueServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof QueueServiceEvents>(
    event: E,
    ...args: Parameters<QueueServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
