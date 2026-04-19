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
import type { Meeting, MeetingOutcome } from '../../shared/meeting-types';

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
  };
}

export class MeetingRepository {
  constructor(private readonly db: Database.Database) {}

  /** Returns the meeting row, or `null` when the id is unknown. */
  get(id: string): Meeting | null {
    const row = this.db
      .prepare(
        `SELECT id, channel_id, topic, state, state_snapshot_json,
                started_at, ended_at, outcome
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
                started_at, ended_at, outcome
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
           started_at, ended_at, outcome
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
