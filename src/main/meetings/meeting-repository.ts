/**
 * MeetingRepository — thin data-access layer over the `meetings` table
 * introduced in migration 004-meetings.
 *
 * Responsibilities:
 *   - Map the SQL snake_case columns to the shared camelCase `Meeting`
 *     interface (`src/shared/meeting-types.ts`). `state_snapshot_json`
 *     stays opaque — the repository treats it as a string blob and the
 *     service layer owns its shape.
 *   - Expose CRUD primitives the {@link MeetingService} composes. No
 *     business rules live here (timestamp generation, error translation,
 *     "one active meeting per channel" enforcement — all upstream).
 *
 * Active-meeting uniqueness:
 *   Migration 004 declares `idx_meetings_active_per_channel` as a partial
 *   UNIQUE index on `(channel_id) WHERE ended_at IS NULL`. The repository
 *   performs no application-level check — it trusts SQLite to surface the
 *   collision as a `SQLITE_CONSTRAINT_UNIQUE`. The service layer translates
 *   the SQLite error into a domain {@link AlreadyActiveMeetingError}.
 */

import type Database from 'better-sqlite3';
import type {
  ActiveMeetingSummary,
  Meeting,
  MeetingKind,
  MeetingOutcome,
} from '../../shared/meeting-types';
import { sessionStateToIndex } from '../../shared/constants';

/** Default/Max for `listActive` (spec §7.5 R4 TasksWidget). */
export const ACTIVE_MEETING_DEFAULT_LIMIT = 10;
export const ACTIVE_MEETING_MAX_LIMIT = 50;

/** Snake-case row shape as returned by better-sqlite3. */
interface MeetingRow {
  id: string;
  channel_id: string;
  topic: string;
  state: string;
  state_snapshot_json: string | null;
  started_at: number;
  ended_at: number | null;
  outcome: MeetingOutcome | null;
  paused_at: number | null;
  kind: MeetingKind;
}

function rowToMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    channelId: row.channel_id,
    topic: row.topic,
    state: row.state,
    stateSnapshotJson: row.state_snapshot_json,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome,
    pausedAt: row.paused_at,
    kind: row.kind,
  };
}

export class MeetingRepository {
  constructor(private readonly db: Database.Database) {}

  /** Returns the meeting row, or `null` when the id is unknown. */
  get(id: string): Meeting | null {
    const row = this.db
      .prepare(
        `SELECT id, channel_id, topic, state, state_snapshot_json,
                started_at, ended_at, outcome, paused_at, kind
         FROM meetings WHERE id = ?`,
      )
      .get(id) as MeetingRow | undefined;
    return row ? rowToMeeting(row) : null;
  }

  /**
   * Returns the single active meeting (ended_at IS NULL) for `channelId`,
   * or `null` when none exists. The partial unique index guarantees at
   * most one match, so this is a point lookup not a list.
   */
  getActiveByChannel(channelId: string): Meeting | null {
    const row = this.db
      .prepare(
        `SELECT id, channel_id, topic, state, state_snapshot_json,
                started_at, ended_at, outcome, paused_at, kind
         FROM meetings
         WHERE channel_id = ? AND ended_at IS NULL`,
      )
      .get(channelId) as MeetingRow | undefined;
    return row ? rowToMeeting(row) : null;
  }

  /**
   * Inserts a fully-populated meeting row. Caller is responsible for
   * generating `id` (UUID) and `startedAt`.
   *
   * Surfaces the raw SqliteError on UNIQUE violations; the service layer
   * translates `idx_meetings_active_per_channel` into
   * {@link AlreadyActiveMeetingError}.
   */
  insert(meeting: Meeting): void {
    this.db
      .prepare(
        `INSERT INTO meetings (
           id, channel_id, topic, state, state_snapshot_json,
           started_at, ended_at, outcome, paused_at, kind
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meeting.id,
        meeting.channelId,
        meeting.topic,
        meeting.state,
        meeting.stateSnapshotJson,
        meeting.startedAt,
        meeting.endedAt,
        meeting.outcome,
        meeting.pausedAt,
        meeting.kind,
      );
  }

  /**
   * Marks a meeting as finished: sets `ended_at`, `outcome`, and
   * optionally a final `state_snapshot_json`. Returns `true` when a row
   * was actually updated.
   */
  finish(
    id: string,
    endedAt: number,
    outcome: MeetingOutcome,
    stateSnapshotJson: string | null,
  ): boolean {
    if (stateSnapshotJson === null) {
      // Preserve any existing snapshot when the caller omits one.
      const result = this.db
        .prepare(
          `UPDATE meetings SET ended_at = ?, outcome = ?
           WHERE id = ? AND ended_at IS NULL`,
        )
        .run(endedAt, outcome, id);
      return result.changes > 0;
    }
    const result = this.db
      .prepare(
        `UPDATE meetings SET ended_at = ?, outcome = ?, state_snapshot_json = ?
         WHERE id = ? AND ended_at IS NULL`,
      )
      .run(endedAt, outcome, stateSnapshotJson, id);
    return result.changes > 0;
  }

  /**
   * Counts in-flight meetings — rows with `ended_at IS NULL`. This is
   * the canonical "active meeting" predicate (see
   * `idx_meetings_active_per_channel`); spec §7.5's prose formulation
   * "state NOT IN ('done','failed','aborted')" maps to this column
   * condition because the terminal states all stamp `ended_at`.
   */
  countActive(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM meetings WHERE ended_at IS NULL')
      .get() as { n: number };
    return row.n;
  }

  /**
   * Counts meetings that finished successfully (`outcome = 'accepted'`)
   * at or after `sinceEpochMs`. Used by the dashboard `completedToday`
   * KPI — the caller passes the start-of-local-today epoch so DST
   * boundaries are honoured. 'rejected' / 'aborted' outcomes are NOT
   * counted as completed; only a positive conclusion qualifies.
   */
  countCompletedSince(sinceEpochMs: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM meetings
         WHERE outcome = 'accepted' AND ended_at IS NOT NULL
           AND ended_at >= ?`,
      )
      .get(sinceEpochMs) as { n: number };
    return row.n;
  }

  /**
   * Returns up to `limit` active meetings (ended_at IS NULL) joined with
   * their owning channel + project for the R4 dashboard TasksWidget.
   *
   * `projects.name` is surfaced at the query level so the widget doesn't
   * need a second IPC round-trip to look it up. DM channels have
   * `channel.project_id IS NULL`, which flows through as `projectId =
   * null`/`projectName = null` in the summary.
   *
   * `stateIndex` is derived from `state` via the shared
   * {@link sessionStateToIndex} helper — the `meetings.state` column is
   * a free-text string (no CHECK), so unknown values safely map to 0.
   *
   * Ordering: `started_at DESC` so the newest active meeting is first.
   * `limit` is clamped to `[1, ACTIVE_MEETING_MAX_LIMIT]`.
   */
  listActive(
    limit: number = ACTIVE_MEETING_DEFAULT_LIMIT,
  ): ActiveMeetingSummary[] {
    const clamped = clampLimit(
      limit,
      ACTIVE_MEETING_DEFAULT_LIMIT,
      ACTIVE_MEETING_MAX_LIMIT,
    );
    interface ActiveRow {
      id: string;
      topic: string;
      state: string;
      started_at: number;
      paused_at: number | null;
      channel_id: string;
      channel_name: string;
      project_id: string | null;
      project_name: string | null;
    }
    const rows = this.db
      .prepare(
        `SELECT m.id AS id,
                m.topic AS topic,
                m.state AS state,
                m.started_at AS started_at,
                m.paused_at AS paused_at,
                m.channel_id AS channel_id,
                c.name AS channel_name,
                c.project_id AS project_id,
                p.name AS project_name
         FROM meetings m
         JOIN channels c ON m.channel_id = c.id
         LEFT JOIN projects p ON c.project_id = p.id
         WHERE m.ended_at IS NULL
         ORDER BY m.started_at DESC
         LIMIT ?`,
      )
      .all(clamped) as ActiveRow[];

    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      channelId: row.channel_id,
      channelName: row.channel_name,
      topic: row.topic,
      stateIndex: sessionStateToIndex(row.state),
      stateName: row.state,
      startedAt: row.started_at,
      // Guard against clock skew on persisted rows — never surface negative
      // elapsed time to the UI (a gauge with a negative label is noise).
      elapsedMs: Math.max(0, now - row.started_at),
      pausedAt: row.paused_at,
    }));
  }

  /**
   * Updates the in-flight meeting state + snapshot. Only valid while
   * `ended_at IS NULL`; finished meetings cannot have their state
   * mutated. Returns `true` when a row was actually updated.
   */
  updateState(id: string, state: string, stateSnapshotJson: string | null): boolean {
    const result = this.db
      .prepare(
        `UPDATE meetings SET state = ?, state_snapshot_json = ?
         WHERE id = ? AND ended_at IS NULL`,
      )
      .run(state, stateSnapshotJson, id);
    return result.changes > 0;
  }
}

/**
 * Clamps an optional user-supplied limit to `[1, max]`, falling back to
 * `defaultValue` when the caller passes a non-finite number. Mirrors the
 * helper in `message-repository.ts` — kept local here so the repository
 * stays self-contained and doesn't reach across domain boundaries.
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
