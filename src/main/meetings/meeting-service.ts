/**
 * MeetingService — Meeting lifecycle (start / finish / updateState / getActive).
 *
 * Responsibilities (spec §7.5 meetings + R2 Task 12):
 *   - `start({channelId, topic})` — insert a meeting row with a fresh
 *     UUID `id`, `startedAt = Date.now()`, `state = INITIAL_MEETING_STATE`,
 *     and `stateSnapshotJson = null`. The partial unique index
 *     `idx_meetings_active_per_channel` (migration 004) enforces the
 *     "one active meeting per channel" invariant; collision translates
 *     to {@link AlreadyActiveMeetingError}.
 *   - `finish(id, outcome, snapshotJson?)` — set `ended_at = now`,
 *     `outcome`, and optionally replace `state_snapshot_json` with a
 *     final snapshot. Already-finished meetings or unknown ids raise
 *     {@link MeetingNotFoundError} (idempotent finish is not supported;
 *     the caller should check `getActive` first if unsure).
 *   - `getActive(channelId)` — returns the (at most one) meeting with
 *     `ended_at IS NULL` for the channel, else `null`.
 *   - `updateState(id, state, snapshotJson)` — update the session-state
 *     machine name + its snapshot blob. Only valid while the meeting is
 *     active; finished or unknown ids raise {@link MeetingNotFoundError}.
 *
 * State coupling with SessionStateMachine:
 *   The `state` column stores the SessionStateMachine state name as a
 *   plain string. Migration 004 intentionally does NOT add a CHECK
 *   constraint on the values — SSM owns the enum and adding constraints
 *   here would force a migration every time SSM changes. The service
 *   treats `state` as an opaque string and `state_snapshot_json` as an
 *   opaque blob. Session 3 (IPC layer, Task 18) wires these together.
 *
 * Why no active-before-start pre-check:
 *   We rely on the DB partial unique index to arbitrate collisions. A
 *   pre-check (SELECT then INSERT) would race any concurrent start, and
 *   we'd still need the catch-and-translate on collision anyway. The
 *   single path is both faster and race-free.
 */

import { randomUUID } from 'node:crypto';
import type {
  ActiveMeetingSummary,
  Meeting,
  MeetingKind,
  MeetingOutcome,
} from '../../shared/meeting-types';
import { MeetingRepository } from './meeting-repository';

// ── Constants ──────────────────────────────────────────────────────────

/**
 * The phase string a newly-started meeting begins in.
 *
 * R12-C2 T10a + T10b: 옛 SSM 12-state 모델 폐기. 새 모델은 8 phase
 * (`gather → tally → quick_vote → free_discussion → compose_minutes →
 *  handoff → done | aborted`) 로 진행하며, 첫 phase 는 항상 `gather`.
 *
 * `meetings.state` 컬럼은 자유 문자열이라 phase enum 그대로 저장한다.
 * 본 상수는 string literal 로 가지며, MeetingOrchestrator 가 첫 phase
 * 진입 시 phase enum 값으로 즉시 덮어 쓴다.
 */
export const INITIAL_MEETING_STATE = 'gather';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — lets callers `catch (e instanceof MeetingError)` discriminate. */
export class MeetingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingError';
  }
}

/**
 * Raised by `start()` when a second active meeting would collide with
 * the partial unique index `idx_meetings_active_per_channel`. The
 * existing active meeting is NOT automatically finished; the caller
 * must decide whether to finish the existing one or abort the start.
 */
export class AlreadyActiveMeetingError extends MeetingError {
  constructor(channelId: string) {
    super(
      `channel "${channelId}" already has an active meeting ` +
        `(one active meeting per channel): finish the existing meeting ` +
        `or use getActive() to inspect it`,
    );
    this.name = 'AlreadyActiveMeetingError';
  }
}

/**
 * Raised by `finish()` / `updateState()` when the meeting id is unknown
 * or is already finished (ended_at IS NOT NULL). The latter is
 * deliberately lumped in because "already finished" and "never existed"
 * both mean the same thing from the caller's perspective: there is no
 * active meeting with this id to mutate.
 */
export class MeetingNotFoundError extends MeetingError {
  constructor(id: string) {
    super(
      `meeting not found or already finished: ${id} ` +
        `(updateState/finish require an active meeting)`,
    );
    this.name = 'MeetingNotFoundError';
  }
}

// ── Error-mapping helpers ──────────────────────────────────────────────

interface SqliteErrorLike {
  code?: unknown;
  message?: unknown;
}

function asSqliteErr(err: unknown): SqliteErrorLike | null {
  if (!err || typeof err !== 'object') return null;
  return err as SqliteErrorLike;
}

/**
 * Detects a violation of `idx_meetings_active_per_channel`. SQLite
 * reports partial-unique-index violations with the index name in the
 * error message; we also accept the bare-column form as a forward-
 * compatibility fallback (older SQLite builds phrased it differently).
 */
function isActiveMeetingUniqueViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  return (
    e.message.includes('idx_meetings_active_per_channel') ||
    e.message === 'UNIQUE constraint failed: meetings.channel_id'
  );
}

// ── Input shapes ──────────────────────────────────────────────────────

export interface StartMeetingInput {
  channelId: string;
  /** Free-form short topic. Empty string (default) is allowed — spec §5.2. */
  topic?: string;
  /**
   * D-A T4: distinguishes manually-started meetings (default) from those
   * auto-spawned by {@link MeetingAutoTrigger} on first user message.
   * Persisted as `meetings.kind` (migration 016) so analytics + the
   * "회의록" surface can label provenance without reconstructing it.
   */
  kind?: MeetingKind;
}

// ── Service ────────────────────────────────────────────────────────────

export class MeetingService {
  constructor(private readonly repo: MeetingRepository) {}

  /**
   * Start a new meeting in `channelId`. Generates a UUID id + now
   * timestamp. The DB partial unique index
   * `idx_meetings_active_per_channel` guarantees at most one active
   * meeting per channel.
   *
   * @throws {AlreadyActiveMeetingError} when another active meeting
   *   exists on the same channel.
   */
  start(input: StartMeetingInput): Meeting {
    const meeting: Meeting = {
      id: randomUUID(),
      channelId: input.channelId,
      topic: input.topic ?? '',
      state: INITIAL_MEETING_STATE,
      stateSnapshotJson: null,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      pausedAt: null,
      kind: input.kind ?? 'manual',
    };

    try {
      this.repo.insert(meeting);
    } catch (err) {
      if (isActiveMeetingUniqueViolation(err)) {
        throw new AlreadyActiveMeetingError(input.channelId);
      }
      throw err;
    }

    return meeting;
  }

  /**
   * Finish a meeting: sets `ended_at = now`, `outcome`, and optionally
   * replaces the final `state_snapshot_json`. Omitting
   * `stateSnapshotJson` leaves whatever snapshot was last written via
   * `updateState` intact.
   *
   * @throws {MeetingNotFoundError} when the id is unknown or already
   *   finished.
   */
  finish(
    id: string,
    outcome: MeetingOutcome,
    stateSnapshotJson?: string | null,
  ): Meeting {
    const endedAt = Date.now();
    // Snapshot handling: the repo's 4th argument treats `null` as
    // "preserve existing snapshot" (no write), any string as "replace".
    // Callers who omit the argument OR pass `null` both want preserve —
    // there is no "erase existing snapshot on finish" use case today.
    // If one appears, extend this API with a sentinel rather than
    // overloading null.
    const snapshotArg =
      typeof stateSnapshotJson === 'string' ? stateSnapshotJson : null;
    const updated = this.repo.finish(id, endedAt, outcome, snapshotArg);
    if (!updated) throw new MeetingNotFoundError(id);

    const next = this.repo.get(id);
    if (!next) {
      // Should be impossible — we just updated the row.
      throw new MeetingError(`finish: meeting disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * Return the (at most one) active meeting for `channelId`, or `null`
   * when none exists. Relies on the partial unique index to guarantee
   * singleton semantics.
   */
  getActive(channelId: string): Meeting | null {
    return this.repo.getActiveByChannel(channelId);
  }

  /**
   * 결재 2번 (A, 2026-05-19) — `meeting:edit-topic` wrapper.
   *
   * topic 200 자 cap 은 IPC schema (`meetingEditTopicSchema`) 단계에서 강제
   * — 본 service 는 단순 DB 갱신 + 종료된 회의 race 차단만 책임. 갱신된
   * Meeting 을 반환해 dashboard list-active stream 재방출 caller 가 동일
   * snapshot 으로 push.
   *
   * @throws {MeetingNotFoundError} 회의 ID 가 없거나 이미 종료된 경우.
   */
  updateTopic(id: string, topic: string): Meeting {
    const updated = this.repo.updateTopic(id, topic);
    if (!updated) throw new MeetingNotFoundError(id);
    const next = this.repo.get(id);
    if (!next) {
      throw new MeetingError(`updateTopic: meeting disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * 결재 2번 (A, 2026-05-19) — `meeting:pause` wrapper.
   *
   * `paused_at = now` 으로 DB 갱신. orchestrator in-memory flag (`paused`)
   * 갱신은 호출자 (IPC handler) 가 `MeetingOrchestrator.pause()` 도 같이
   * 호출해 함께 토글. 본 service 는 영속 측만 책임.
   *
   * @throws {MeetingNotFoundError} 회의 ID 가 없거나 이미 종료된 경우.
   * @returns 갱신 시점의 ms epoch (`Date.now()` 결과).
   */
  pause(id: string): number {
    const pausedAt = Date.now();
    const updated = this.repo.setPausedAt(id, pausedAt);
    if (!updated) throw new MeetingNotFoundError(id);
    return pausedAt;
  }

  /**
   * 결재 2번 (A, 2026-05-19) — `meeting:resume` wrapper.
   *
   * `paused_at = NULL` 으로 DB 갱신. orchestrator in-memory flag 갱신은
   * 호출자 책임.
   *
   * @throws {MeetingNotFoundError} 회의 ID 가 없거나 이미 종료된 경우.
   * @returns 재개 시점의 ms epoch (`Date.now()` 결과).
   */
  resume(id: string): number {
    const resumedAt = Date.now();
    const updated = this.repo.setPausedAt(id, null);
    if (!updated) throw new MeetingNotFoundError(id);
    return resumedAt;
  }

  /**
   * Update the in-flight meeting's `state` + `state_snapshot_json`
   * columns. Passing `null` for snapshot is allowed (mirrors initial
   * state).
   *
   * @throws {MeetingNotFoundError} when the id is unknown or the
   *   meeting is already finished.
   */
  updateState(
    id: string,
    state: string,
    stateSnapshotJson: string | null,
  ): Meeting {
    const updated = this.repo.updateState(id, state, stateSnapshotJson);
    if (!updated) throw new MeetingNotFoundError(id);

    const next = this.repo.get(id);
    if (!next) {
      throw new MeetingError(`updateState: meeting disappeared after update: ${id}`);
    }
    return next;
  }

  /** Per-id lookup. Returns `null` when `id` is unknown. */
  get(id: string): Meeting | null {
    return this.repo.get(id);
  }

  /**
   * R4 dashboard TasksWidget accessor. Delegates to the repository — the
   * summary is computed at the SQL layer (join) + by
   * {@link sessionStateToIndex} at read time. `limit` is forwarded
   * verbatim; the repository applies its own clamp.
   */
  listActive(limit?: number): ActiveMeetingSummary[] {
    return this.repo.listActive(limit);
  }
}
