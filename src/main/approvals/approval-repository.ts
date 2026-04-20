/**
 * ApprovalRepository — thin data-access layer over the `approval_items`
 * table introduced in migration 006-approval-inbox.
 *
 * Responsibilities:
 *   - Map SQL snake_case columns to the shared camelCase `ApprovalItem`
 *     interface (`src/shared/approval-types.ts`).
 *   - Round-trip `payload` (unknown JSON) through the `payload_json`
 *     column. `null` is stored as the JSON literal `"null"` (see note
 *     below); `undefined` is normalised to `null` before serialisation
 *     so the column never holds SQL NULL (migration 006 declares it
 *     NOT NULL).
 *   - Expose INSERT / updateStatus / list / get primitives the
 *     {@link ApprovalService} composes. No business rules, no events.
 *
 * Hard-DELETE is INTENTIONALLY not implemented (CB-7, spec §7.7, and
 * the migration 006 header). Closing an approval means transitioning to
 * `status='superseded'` or `status='expired'` via `updateStatus`. A
 * missing `delete` method is a compile-time guardrail: callers cannot
 * accidentally wipe audit trail.
 *
 * `payload_json` NOT NULL invariant:
 *   Migration 006 declares `payload_json TEXT NOT NULL`. A caller that
 *   passes `payload: null` or `payload: undefined` MUST still round-trip
 *   through JSON so the column holds the literal string `"null"`. The
 *   service reads it back as `null`, which matches the camelCase
 *   `ApprovalItem.payload: unknown` contract.
 *
 * Sort stability:
 *   `list` orders by `created_at DESC, id DESC`. `created_at` is not
 *   monotonic across rows inserted in the same millisecond, so `id` is a
 *   deterministic tiebreaker (UUID string comparison is stable).
 */

import type Database from 'better-sqlite3';
import type {
  ApprovalItem,
  ApprovalKind,
  ApprovalStatus,
} from '../../shared/approval-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  project_id: string | null;
  channel_id: string | null;
  meeting_id: string | null;
  requester_id: string | null;
  payload_json: string;
  status: ApprovalStatus;
  decision_comment: string | null;
  created_at: number;
  decided_at: number | null;
}

function rowToItem(row: ApprovalRow): ApprovalItem {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    channelId: row.channel_id,
    meetingId: row.meeting_id,
    requesterId: row.requester_id,
    // Migration 006 makes payload_json NOT NULL so we always get a
    // string; the service writes the JSON literal "null" when the
    // caller passes no payload. `JSON.parse("null")` round-trips to
    // `null`, preserving the caller's intent.
    payload: JSON.parse(row.payload_json) as unknown,
    status: row.status,
    decisionComment: row.decision_comment,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export interface ListApprovalsFilter {
  status?: ApprovalStatus;
  projectId?: string;
}

export class ApprovalRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Inserts a fully-populated approval row. Caller (service) is
   * responsible for generating `id` (UUID) + `createdAt` (epoch ms)
   * and for setting `status='pending'`, `decidedAt=null`,
   * `decisionComment=null` on new items.
   *
   * `payload` is serialised via `JSON.stringify`; `undefined` is
   * normalised to `null` first so the column (NOT NULL) always holds
   * a valid JSON literal.
   */
  insert(item: ApprovalItem): void {
    const payloadJson = JSON.stringify(
      item.payload === undefined ? null : item.payload,
    );
    this.db
      .prepare(
        `INSERT INTO approval_items (
           id, kind, project_id, channel_id, meeting_id, requester_id,
           payload_json, status, decision_comment, created_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.kind,
        item.projectId,
        item.channelId,
        item.meetingId,
        item.requesterId,
        payloadJson,
        item.status,
        item.decisionComment,
        item.createdAt,
        item.decidedAt,
      );
  }

  /**
   * Updates the lifecycle columns — `status`, `decision_comment`,
   * `decided_at`. Used for every post-create transition
   * (approve / reject / expire / supersede). Row identity and audit
   * metadata are never touched.
   *
   * The service layer is responsible for the legality of the
   * transition (e.g. rejecting a second `decide` on a non-pending
   * item); this method performs the update unconditionally when the
   * row exists.
   *
   * Returns `true` iff the row was updated (existed).
   */
  updateStatus(
    id: string,
    status: ApprovalStatus,
    comment: string | null,
    decidedAt: number | null,
  ): boolean {
    const info = this.db
      .prepare(
        `UPDATE approval_items
         SET status = ?, decision_comment = ?, decided_at = ?
         WHERE id = ?`,
      )
      .run(status, comment, decidedAt, id);
    return info.changes > 0;
  }

  /**
   * Returns the approval by UUID, or `null` when unknown. Note:
   * superseded/expired rows are still returned — the whole point of
   * CB-7 is that the audit row survives its own retirement.
   */
  get(id: string): ApprovalItem | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, project_id, channel_id, meeting_id, requester_id,
                payload_json, status, decision_comment, created_at, decided_at
         FROM approval_items WHERE id = ?`,
      )
      .get(id) as ApprovalRow | undefined;
    return row ? rowToItem(row) : null;
  }

  /**
   * Counts approval rows in `status`. Used by the dashboard aggregator
   * (R4 §7.5 `pendingApprovals` KPI) — returning a raw number avoids
   * materialising + JSON-parsing every payload via `list().length`.
   */
  countByStatus(status: ApprovalStatus): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM approval_items WHERE status = ?')
      .get(status) as { n: number };
    return row.n;
  }

  /**
   * Lists approvals newest-first. Both filters are optional and
   * independent — passing both ANDs them. Tiebreaker on same-ms rows
   * is `id DESC` (deterministic UUID string order).
   */
  list(filter: ListApprovalsFilter = {}): ApprovalItem[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status !== undefined) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.projectId !== undefined) {
      clauses.push('project_id = ?');
      params.push(filter.projectId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT id, kind, project_id, channel_id, meeting_id, requester_id,
                payload_json, status, decision_comment, created_at, decided_at
         FROM approval_items
         ${where}
         ORDER BY created_at DESC, id DESC`,
      )
      .all(...params) as ApprovalRow[];
    return rows.map(rowToItem);
  }

  // `delete` is INTENTIONALLY not implemented. CB-7 / spec §7.7 forbid
  // hard-deleting approval rows; retirement happens via `updateStatus`
  // with `'superseded'` or `'expired'`. The absence of this method is a
  // compile-time guardrail — callers that try `repo.delete(id)` will
  // fail typecheck.
}
