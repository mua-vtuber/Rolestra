import type Database from 'better-sqlite3';
import type {
  MeetingReviewGate,
  MeetingReviewGateKind,
  MeetingReviewGateStatus,
  MeetingReviewListRequest,
} from '../../shared/meeting-review-types';
import type { ChannelRole } from '../../shared/channel-role-types';

interface MeetingReviewGateRow {
  id: string;
  project_id: string;
  meeting_id: string;
  source_channel_id: string;
  target_channel_id: string | null;
  target_role: ChannelRole;
  kind: MeetingReviewGateKind;
  status: MeetingReviewGateStatus;
  title: string;
  document_path: string;
  document_body_snapshot: string;
  user_note: string | null;
  payload_json: string | null;
  created_at: number;
  decided_at: number | null;
}

const COLUMNS_SELECT = `
  id, project_id, meeting_id, source_channel_id, target_channel_id,
  target_role, kind, status, title, document_path, document_body_snapshot,
  user_note, payload_json, created_at, decided_at
`;

function rowToGate(row: MeetingReviewGateRow): MeetingReviewGate {
  return {
    id: row.id,
    projectId: row.project_id,
    meetingId: row.meeting_id,
    sourceChannelId: row.source_channel_id,
    targetChannelId: row.target_channel_id,
    targetRole: row.target_role,
    kind: row.kind,
    status: row.status,
    title: row.title,
    documentPath: row.document_path,
    documentBodySnapshot: row.document_body_snapshot,
    userNote: row.user_note,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class MeetingReviewGateRepository {
  constructor(private readonly db: Database.Database) {}

  withTransaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  insert(gate: MeetingReviewGate): void {
    this.db
      .prepare(
        `INSERT INTO meeting_review_gate (
           id, project_id, meeting_id, source_channel_id, target_channel_id,
           target_role, kind, status, title, document_path,
           document_body_snapshot, user_note, payload_json, created_at,
           decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        gate.id,
        gate.projectId,
        gate.meetingId,
        gate.sourceChannelId,
        gate.targetChannelId,
        gate.targetRole,
        gate.kind,
        gate.status,
        gate.title,
        gate.documentPath,
        gate.documentBodySnapshot,
        gate.userNote,
        gate.payloadJson,
        gate.createdAt,
        gate.decidedAt,
      );
  }

  findById(id: string): MeetingReviewGate | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS_SELECT} FROM meeting_review_gate WHERE id = ?`)
      .get(id) as MeetingReviewGateRow | undefined;
    return row ? rowToGate(row) : null;
  }

  list(input: MeetingReviewListRequest = {}): MeetingReviewGate[] {
    const clauses: string[] = [];
    const params: Array<string> = [];
    if (input.projectId !== undefined) {
      clauses.push('project_id = ?');
      params.push(input.projectId);
    }
    if (input.status !== undefined) {
      clauses.push('status = ?');
      params.push(input.status);
    }
    if (input.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(input.kind);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM meeting_review_gate
         ${where}
         ORDER BY created_at DESC, id ASC`,
      )
      .all(...params) as MeetingReviewGateRow[];
    return rows.map(rowToGate);
  }

  updateDecision(input: {
    id: string;
    status: Exclude<MeetingReviewGateStatus, 'pending'>;
    userNote: string | null;
    decidedAt: number;
  }): MeetingReviewGate | null {
    const result = this.db
      .prepare(
        `UPDATE meeting_review_gate
         SET status = ?, user_note = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(input.status, input.userNote, input.decidedAt, input.id);
    if (result.changes === 0) return null;
    return this.findById(input.id);
  }
}
