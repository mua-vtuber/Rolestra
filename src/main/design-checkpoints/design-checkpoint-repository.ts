import type Database from 'better-sqlite3';
import type {
  DesignCheckpoint,
  DesignCheckpointKind,
  DesignCheckpointStatus,
} from '../../shared/design-checkpoint-types';

interface DesignCheckpointRow {
  id: string;
  project_id: string;
  meeting_id: string;
  channel_id: string;
  kind: DesignCheckpointKind;
  status: DesignCheckpointStatus;
  title: string;
  document_path: string;
  document_body_snapshot: string;
  user_note: string | null;
  payload_json: string | null;
  created_at: number;
  decided_at: number | null;
}

const COLUMNS_SELECT = `
  id, project_id, meeting_id, channel_id, kind, status, title,
  document_path, document_body_snapshot, user_note, payload_json,
  created_at, decided_at
`;

function rowToCheckpoint(row: DesignCheckpointRow): DesignCheckpoint {
  return {
    id: row.id,
    projectId: row.project_id,
    meetingId: row.meeting_id,
    channelId: row.channel_id,
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

export class DesignCheckpointRepository {
  constructor(private readonly db: Database.Database) {}

  withTransaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  insert(checkpoint: DesignCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO design_checkpoint (
           id, project_id, meeting_id, channel_id, kind, status, title,
           document_path, document_body_snapshot, user_note, payload_json,
           created_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpoint.id,
        checkpoint.projectId,
        checkpoint.meetingId,
        checkpoint.channelId,
        checkpoint.kind,
        checkpoint.status,
        checkpoint.title,
        checkpoint.documentPath,
        checkpoint.documentBodySnapshot,
        checkpoint.userNote,
        checkpoint.payloadJson,
        checkpoint.createdAt,
        checkpoint.decidedAt,
      );
  }

  findById(id: string): DesignCheckpoint | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS_SELECT} FROM design_checkpoint WHERE id = ?`)
      .get(id) as DesignCheckpointRow | undefined;
    return row ? rowToCheckpoint(row) : null;
  }

  listByMeeting(input: {
    projectId: string;
    meetingId: string;
    kind?: DesignCheckpointKind;
  }): DesignCheckpoint[] {
    const clauses = ['project_id = ?', 'meeting_id = ?'];
    const params: string[] = [input.projectId, input.meetingId];
    if (input.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(input.kind);
    }
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM design_checkpoint
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...params) as DesignCheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  updateDecision(input: {
    id: string;
    status: Exclude<DesignCheckpointStatus, 'pending'>;
    userNote: string | null;
    decidedAt: number;
  }): DesignCheckpoint | null {
    const result = this.db
      .prepare(
        `UPDATE design_checkpoint
         SET status = ?, user_note = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(input.status, input.userNote, input.decidedAt, input.id);
    if (result.changes === 0) return null;
    return this.findById(input.id);
  }

  isWireframeAutoSkipEnabled(projectId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT wireframe_auto_skip
         FROM design_checkpoint_preference
         WHERE project_id = ?`,
      )
      .get(projectId) as { wireframe_auto_skip: number } | undefined;
    return row?.wireframe_auto_skip === 1;
  }

  setWireframeAutoSkip(input: {
    projectId: string;
    enabled: boolean;
    updatedAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO design_checkpoint_preference (
           project_id, wireframe_auto_skip, updated_at
         ) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           wireframe_auto_skip = excluded.wireframe_auto_skip,
           updated_at = excluded.updated_at`,
      )
      .run(input.projectId, input.enabled ? 1 : 0, input.updatedAt);
  }
}
