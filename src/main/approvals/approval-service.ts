/**
 * ApprovalService — create / decide / list / retire approval items.
 *
 * Responsibilities (spec §7.7 + R2 Task 13):
 *   - `create(input)` inserts a new approval with a UUID `id`,
 *     `status='pending'`, `createdAt` epoch ms, `decidedAt=null`,
 *     `decisionComment=null`, and emits `'created'` on the service's
 *     EventEmitter. Task 19 will replace this emitter with the typed
 *     stream-bridge; until then the EventEmitter is the authoritative
 *     in-process broadcast.
 *   - `decide(id, decision, comment?)` transitions a pending item to
 *     a terminal state. Three decisions:
 *       - `'approve'`       → `status='approved'`
 *       - `'reject'`        → `status='rejected'`
 *       - `'conditional'`   → `status='approved'` (spec §7.7: "허가는
 *         되고 조건이 시스템 메시지로 주입"). The caller's `comment`
 *         carries the condition; the `'decided'` event exposes the raw
 *         `decision='conditional'` so downstream listeners (system-
 *         message injector) can distinguish conditional from plain
 *         approval.
 *     `decidedAt` is stamped with `Date.now()`.
 *   - `expire(id)` / `supersede(id)` retire a row WITHOUT hard-DELETE.
 *     Used when a newer request obsoletes a pending one, or when the
 *     item aged past its TTL. These paths do NOT fire `'decided'` —
 *     they are lifecycle events, not user decisions.
 *   - `list(filter)` / `get(id)` pass-through to the repository.
 *
 * Retirement-over-DELETE (CB-7):
 *   Migration 006 keeps `approval_items` rows forever. `ApprovalRepository`
 *   intentionally has no `delete` method. Callers that need to "remove"
 *   an item must `expire` or `supersede` it — the row stays in the table
 *   for audit and FK SET NULL fan-out.
 *
 * Event isolation (Task 11 pattern, commit 39d8e1f):
 *   `emit` is a broadcast. Listener throws MUST NOT rewrite the contract
 *   of `create` / `decide`. We wrap each `emit` in try/catch and log via
 *   `console.warn` with a `[rolestra.approvals]` marker so the listener
 *   bug is still observable but the caller still gets its return value.
 *
 * Payload round-trip:
 *   `payload` is persisted as JSON in `approval_items.payload_json`
 *   (NOT NULL). `null` survives as the JSON literal `"null"` and reads
 *   back as `null`. `undefined` is normalised to `null` on the repo
 *   boundary so the NOT NULL invariant holds.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalItem,
  ApprovalKind,
  ApprovalStatus,
} from '../../shared/approval-types';
import { ApprovalRepository } from './approval-repository';
import { CONSENSUS_DECISION_TTL_MS as SHARED_CONSENSUS_DECISION_TTL_MS } from '../../shared/timeouts';
import { tryGetLogger } from '../log/logger-accessor';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — `catch (e instanceof ApprovalError)` for discrimination. */
export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/**
 * Raised by `decide` / `expire` / `supersede` when the id does not
 * match any row. Stable class so IPC callers can react without
 * string-matching SQLite output.
 */
export class ApprovalNotFoundError extends ApprovalError {
  constructor(id: string) {
    super(`approval not found: ${id}`);
    this.name = 'ApprovalNotFoundError';
  }
}

/**
 * Raised by `decide` when the target row is not in `status='pending'`.
 * Already-decided items are immutable under spec §7.7 — a second
 * decision would rewrite audit history.
 */
export class AlreadyDecidedError extends ApprovalError {
  constructor(id: string, currentStatus: ApprovalStatus) {
    super(
      `approval ${id} is already ${currentStatus} — cannot re-decide a ` +
        `non-pending item (spec §7.7)`,
    );
    this.name = 'AlreadyDecidedError';
  }
}

// ── Input shapes ──────────────────────────────────────────────────────

/**
 * Shape of `ApprovalService.create()` input.
 *
 * Mirrors `ApprovalItem` minus the fields the service generates
 * internally (`id`, `status`, `createdAt`, `decidedAt`,
 * `decisionComment`). All `*_id` foreign keys are optional — an
 * approval might be scoped to a project, a channel, a meeting, none,
 * or several.
 */
export interface CreateApprovalInput {
  kind: ApprovalKind;
  projectId?: string | null;
  channelId?: string | null;
  meetingId?: string | null;
  requesterId?: string | null;
  payload?: unknown;
}

// ── Event typing ──────────────────────────────────────────────────────

export const APPROVAL_CREATED_EVENT = 'created' as const;
export const APPROVAL_DECIDED_EVENT = 'decided' as const;

/**
 * Payload delivered to `'decided'` listeners. The raw `decision`
 * literal is exposed in addition to the updated item so downstream
 * code (system-message injector for `conditional`) can distinguish
 * approve-with-condition from plain approve — both map to
 * `status='approved'` on the item itself.
 */
export interface ApprovalDecidedPayload {
  item: ApprovalItem;
  decision: ApprovalDecision;
  comment: string | null;
}

export interface ApprovalServiceEvents {
  created: (item: ApprovalItem) => void;
  decided: (payload: ApprovalDecidedPayload) => void;
}

// ── Service ────────────────────────────────────────────────────────────

/**
 * Maps the three `ApprovalDecision` literals to their persisted
 * `ApprovalStatus`. Kept as an explicit table so the `conditional →
 * approved` collapse is reviewable at a glance (spec §7.7).
 */
function decisionToStatus(decision: ApprovalDecision): ApprovalStatus {
  switch (decision) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'conditional':
      // spec §7.7: the comment carries the condition; a downstream
      // listener injects it as a system message. On the `approval_items`
      // table, conditional collapses to `approved`.
      return 'approved';
  }
}

/**
 * Default consensus_decision approval TTL (24h). Re-exports the shared
 * timeout so the orchestrator and the rehydrate path see the same wall-
 * clock value — a rehydrated row aged from before app restart still
 * expires at the same instant the original meeting timer would have.
 */
export const CONSENSUS_DECISION_TTL_MS = SHARED_CONSENSUS_DECISION_TTL_MS;

/**
 * Result of {@link ApprovalService.rehydrateConsensusTimers}. Returned for
 * observability — boot logs use it to assert the rehydrated count, tests
 * assert it directly.
 */
export interface ConsensusRehydrateResult {
  /** Rows whose remaining TTL > 0 — a setTimeout was rescheduled. */
  rehydrated: number;
  /** Rows whose deadline passed during downtime — expired immediately. */
  expired: number;
}

export class ApprovalService extends EventEmitter {
  /**
   * Rehydrated consensus expiry timers, keyed by approval id. Populated
   * by {@link rehydrateConsensusTimers} and cleared either when the timer
   * fires, when the matching `'decided'` event arrives (cancelling the
   * timer to avoid overwriting a user's decision), or via
   * {@link disposeRehydratedConsensusTimers}.
   */
  private rehydratedConsensusTimers = new Map<string, NodeJS.Timeout>();
  /** Listener installed by {@link rehydrateConsensusTimers}; removed on dispose. */
  private rehydratedConsensusDecidedListener:
    | ((payload: ApprovalDecidedPayload) => void)
    | null = null;

  constructor(private readonly repo: ApprovalRepository) {
    super();
  }

  /**
   * Boot helper — re-arms expiry setTimeout for every pending
   * `consensus_decision` approval after a process restart (R7 D2 / R10
   * Task 11). Without this, an approval row created moments before a
   * crash would stay `pending` forever because its in-memory timer was
   * owned by the now-gone {@link MeetingOrchestrator} instance.
   *
   * Behaviour:
   *   - Rows with `now >= createdAt + ttl` expire immediately. The
   *     in-memory state has already drifted past the original deadline,
   *     so we honour the wall-clock contract instead of granting a fresh
   *     24h window.
   *   - Rows with `now < createdAt + ttl` get a fresh setTimeout for the
   *     remaining slack. The timer cross-checks the row's status before
   *     calling `expire` (a user's decision via IPC clears the timer
   *     through the listener below, but a race with the timer firing is
   *     possible — we never want to overwrite a recorded decision).
   *
   * Idempotent: calling this twice cancels the prior batch first. Tests
   * inject `nowMs` to assert deterministically; production passes neither
   * `ttlMs` nor `nowMs` and gets the 24h default + Date.now().
   */
  rehydrateConsensusTimers(opts: {
    ttlMs?: number;
    nowMs?: number;
  } = {}): ConsensusRehydrateResult {
    const ttl = opts.ttlMs ?? CONSENSUS_DECISION_TTL_MS;
    const now = opts.nowMs ?? Date.now();

    this.disposeRehydratedConsensusTimers();

    const pending = this.repo.list({ status: 'pending' });
    let rehydrated = 0;
    let expired = 0;
    for (const item of pending) {
      if (item.kind !== 'consensus_decision') continue;
      const expireAt = item.createdAt + ttl;
      if (expireAt <= now) {
        try {
          this.expire(item.id);
          expired += 1;
        } catch {
          // Row already retired by another caller in a tight race —
          // safe to swallow; the audit row is unchanged either way.
        }
        continue;
      }
      const remaining = expireAt - now;
      const timer = setTimeout(() => {
        this.rehydratedConsensusTimers.delete(item.id);
        // Re-read status: a user's decision (via the 'decided' event
        // listener installed below) cancels the timer eagerly, but a
        // race with the timer dispatch is still possible.
        const current = this.repo.get(item.id);
        if (current === null || current.status !== 'pending') return;
        try {
          this.expire(item.id);
        } catch {
          // Race — already settled.
        }
      }, remaining);
      if (typeof timer.unref === 'function') timer.unref();
      this.rehydratedConsensusTimers.set(item.id, timer);
      rehydrated += 1;
    }

    // Hook 'decided' so the rehydrated timer never overwrites a recorded
    // user decision. The listener is removed (and timers cleared) by
    // disposeRehydratedConsensusTimers().
    const onDecided = (payload: ApprovalDecidedPayload): void => {
      const t = this.rehydratedConsensusTimers.get(payload.item.id);
      if (t === undefined) return;
      clearTimeout(t);
      this.rehydratedConsensusTimers.delete(payload.item.id);
    };
    this.on(APPROVAL_DECIDED_EVENT, onDecided);
    this.rehydratedConsensusDecidedListener = onDecided;

    return { rehydrated, expired };
  }

  /**
   * Cancel all rehydrated consensus timers and detach the 'decided'
   * listener installed by {@link rehydrateConsensusTimers}. Call from app
   * shutdown to keep tests / repeated boots tidy. Safe to call when no
   * timers are pending (no-op).
   */
  disposeRehydratedConsensusTimers(): void {
    for (const timer of this.rehydratedConsensusTimers.values()) {
      clearTimeout(timer);
    }
    this.rehydratedConsensusTimers.clear();
    if (this.rehydratedConsensusDecidedListener !== null) {
      this.off(APPROVAL_DECIDED_EVENT, this.rehydratedConsensusDecidedListener);
      this.rehydratedConsensusDecidedListener = null;
    }
  }

  /**
   * Creates a new pending approval. Generates `id` + `createdAt` for
   * the caller and emits `'created'` with the saved row on success.
   *
   * `payload` defaults to `null` when omitted (the column is NOT NULL
   * so a missing payload is persisted as the JSON literal `"null"`).
   *
   * Listener exceptions are swallowed and logged — see file header for
   * rationale.
   */
  create(input: CreateApprovalInput): ApprovalItem {
    const item: ApprovalItem = {
      id: randomUUID(),
      kind: input.kind,
      projectId: input.projectId ?? null,
      channelId: input.channelId ?? null,
      meetingId: input.meetingId ?? null,
      requesterId: input.requesterId ?? null,
      payload: input.payload === undefined ? null : input.payload,
      status: 'pending',
      decisionComment: null,
      createdAt: Date.now(),
      decidedAt: null,
    };

    this.repo.insert(item);

    // Emit is a broadcast — listener failures must not rewrite the
    // contract of `create()`, which is "row is saved, you get the
    // ApprovalItem back". Without this guard, a buggy subscriber would
    // propagate up the return path and the caller would never see the
    // item (even though the INSERT committed).
    //
    // Pattern mirrors message-service.ts (Task 11 fix, commit 39d8e1f).
    // TODO R2-log: swap console.warn for structured logger.
    try {
      this.emit(APPROVAL_CREATED_EVENT, item);
    } catch (err) {
      this.warnListener('create', err);
    }
    return item;
  }

  /**
   * Decides a pending approval. Rejects with {@link ApprovalNotFoundError}
   * if the id is unknown, or {@link AlreadyDecidedError} if the target
   * is not in `status='pending'`. Returns the updated row.
   *
   * `'conditional'` collapses to `status='approved'` on persistence
   * (spec §7.7); the `'decided'` event still carries the raw literal
   * so downstream code can distinguish the two.
   *
   * @throws {ApprovalNotFoundError} when `id` does not exist.
   * @throws {AlreadyDecidedError}   when the row is not pending.
   */
  decide(
    id: string,
    decision: ApprovalDecision,
    comment?: string,
  ): ApprovalItem {
    const existing = this.repo.get(id);
    if (existing === null) {
      throw new ApprovalNotFoundError(id);
    }
    if (existing.status !== 'pending') {
      throw new AlreadyDecidedError(id, existing.status);
    }

    const newStatus = decisionToStatus(decision);
    const commentOrNull = comment ?? null;
    const decidedAt = Date.now();
    // Row existed moments ago and we are the sole mutator in-process;
    // if updateStatus returns false here it is a bug, but the happy
    // path is 1 row updated.
    this.repo.updateStatus(id, newStatus, commentOrNull, decidedAt);

    // Re-read so the returned item reflects what SQLite actually has
    // (matches the pattern in the plan sample and keeps the service's
    // return value authoritative). `get` returns non-null because the
    // previous UPDATE matched.
    const updated = this.repo.get(id);
    if (updated === null) {
      // Should be impossible — we just updated a row by primary key.
      // Surface loudly rather than return stale input.
      throw new ApprovalNotFoundError(id);
    }

    try {
      this.emit(APPROVAL_DECIDED_EVENT, {
        item: updated,
        decision,
        comment: commentOrNull,
      });
    } catch (err) {
      this.warnListener('decide', err);
    }
    return updated;
  }

  /**
   * Transitions a row to `status='expired'`. Used when an approval
   * aged past its TTL. Does NOT emit `'decided'` — expiration is a
   * lifecycle transition, not a user decision.
   *
   * @throws {ApprovalNotFoundError} when `id` does not exist.
   */
  expire(id: string): void {
    const ok = this.repo.updateStatus(id, 'expired', null, Date.now());
    if (!ok) {
      throw new ApprovalNotFoundError(id);
    }
  }

  /**
   * Transitions a row to `status='superseded'`. Used when a newer
   * approval request obsoletes this one; the old row stays for audit
   * (CB-7) and the new row carries the live workflow.
   *
   * @throws {ApprovalNotFoundError} when `id` does not exist.
   */
  supersede(id: string): void {
    const ok = this.repo.updateStatus(id, 'superseded', null, Date.now());
    if (!ok) {
      throw new ApprovalNotFoundError(id);
    }
  }

  /** Returns the approval by id, or `null` when unknown. */
  get(id: string): ApprovalItem | null {
    return this.repo.get(id);
  }

  /**
   * Lists approvals newest-first with optional `status` / `projectId`
   * filters. Combining filters ANDs them.
   */
  list(filter: { status?: ApprovalStatus; projectId?: string } = {}): ApprovalItem[] {
    return this.repo.list(filter);
  }

  /**
   * Centralised listener-failure logger. Routes through the shared
   * {@link StructuredLogger} when available (F5-T8), falling back to
   * `console.warn` with the legacy `[rolestra.approvals]` marker so
   * very-early-boot or test paths without a wired logger still record
   * the failure.
   */
  private warnListener(origin: 'create' | 'decide', err: unknown): void {
    const errMessage = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : undefined;
    const logger = tryGetLogger();
    if (logger) {
      logger.warn({
        component: 'approvals',
        action: 'listener-threw',
        result: 'failure',
        error: {
          code: errName ?? 'Error',
          message: errMessage,
          stack: err instanceof Error ? err.stack : undefined,
        },
        metadata: { origin },
      });
      return;
    }
    console.warn('[rolestra.approvals] listener threw:', {
      origin,
      name: errName,
      message: errMessage,
    });
  }

  // ── typed EventEmitter overloads ───────────────────────────────────

  on<E extends keyof ApprovalServiceEvents>(
    event: E,
    listener: ApprovalServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof ApprovalServiceEvents>(
    event: E,
    listener: ApprovalServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof ApprovalServiceEvents>(
    event: E,
    ...args: Parameters<ApprovalServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
