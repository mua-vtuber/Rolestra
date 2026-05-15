import type Database from 'better-sqlite3';
import type {
  PlanningDesignCheckRecord,
  PlanningDesignCheckStatus,
  PlanningDesignCheckUserDecision,
  PlanningDesignCheckVerdict,
} from '../../shared/planning-design-check-types';
import type { ChannelRole } from '../../shared/channel-role-types';

interface PlanningDesignCheckRow {
  id: string;
  project_id: string;
  source_design_meeting_id: string;
  design_channel_id: string;
  design_channel_role: ChannelRole;
  planning_channel_id: string;
  implementation_channel_id: string | null;
  request_title: string;
  request_body: string;
  final_design_minutes_path: string;
  final_design_minutes_body: string;
  snapshot_desktop_path: string | null;
  snapshot_mobile_path: string | null;
  wireframe_checkpoints_json: string;
  wireframe_user_notes_json: string;
  work_bundle_key: string | null;
  original_planning_minutes_id: string | null;
  original_planning_minutes_path: string | null;
  original_planning_minutes_body: string | null;
  original_planning_minutes_missing_reason: string | null;
  return_count: number;
  verdict: PlanningDesignCheckVerdict | null;
  status: PlanningDesignCheckStatus;
  reason: string | null;
  revision_direction: string | null;
  implementation_dispatch_id: string | null;
  design_return_dispatch_id: string | null;
  user_decision: PlanningDesignCheckUserDecision | null;
  user_decision_note: string | null;
  user_decision_dispatch_id: string | null;
  payload_json: string | null;
  created_at: number;
  decided_at: number | null;
}

const COLUMNS_SELECT = `
  id, project_id, source_design_meeting_id, design_channel_id,
  design_channel_role, planning_channel_id, implementation_channel_id,
  request_title, request_body, final_design_minutes_path,
  final_design_minutes_body, snapshot_desktop_path, snapshot_mobile_path,
  wireframe_checkpoints_json, wireframe_user_notes_json, work_bundle_key,
  original_planning_minutes_id, original_planning_minutes_path,
  original_planning_minutes_body, original_planning_minutes_missing_reason,
  return_count, verdict, status, reason, revision_direction,
  implementation_dispatch_id, design_return_dispatch_id, user_decision,
  user_decision_note, user_decision_dispatch_id, payload_json, created_at,
  decided_at
`;

function rowToRecord(row: PlanningDesignCheckRow): PlanningDesignCheckRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceDesignMeetingId: row.source_design_meeting_id,
    designChannelId: row.design_channel_id,
    designChannelRole: row.design_channel_role,
    planningChannelId: row.planning_channel_id,
    implementationChannelId: row.implementation_channel_id,
    requestTitle: row.request_title,
    requestBody: row.request_body,
    finalDesignMinutesPath: row.final_design_minutes_path,
    finalDesignMinutesBody: row.final_design_minutes_body,
    snapshotDesktopPath: row.snapshot_desktop_path,
    snapshotMobilePath: row.snapshot_mobile_path,
    wireframeCheckpointsJson: row.wireframe_checkpoints_json,
    wireframeUserNotesJson: row.wireframe_user_notes_json,
    workBundleKey: row.work_bundle_key,
    originalPlanningMinutesId: row.original_planning_minutes_id,
    originalPlanningMinutesPath: row.original_planning_minutes_path,
    originalPlanningMinutesBody: row.original_planning_minutes_body,
    originalPlanningMinutesMissingReason:
      row.original_planning_minutes_missing_reason,
    returnCount: row.return_count,
    verdict: row.verdict,
    status: row.status,
    reason: row.reason,
    revisionDirection: row.revision_direction,
    implementationDispatchId: row.implementation_dispatch_id,
    designReturnDispatchId: row.design_return_dispatch_id,
    userDecision: row.user_decision,
    userDecisionNote: row.user_decision_note,
    userDecisionDispatchId: row.user_decision_dispatch_id,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class PlanningDesignCheckRepository {
  constructor(private readonly db: Database.Database) {}

  withTransaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  insert(record: PlanningDesignCheckRecord): void {
    this.db
      .prepare(
        `INSERT INTO planning_design_check (
           id, project_id, source_design_meeting_id, design_channel_id,
           design_channel_role, planning_channel_id, implementation_channel_id,
           request_title, request_body, final_design_minutes_path,
           final_design_minutes_body, snapshot_desktop_path, snapshot_mobile_path,
           wireframe_checkpoints_json, wireframe_user_notes_json,
           work_bundle_key, original_planning_minutes_id,
           original_planning_minutes_path, original_planning_minutes_body,
           original_planning_minutes_missing_reason, return_count, verdict,
           status, reason, revision_direction, implementation_dispatch_id,
           design_return_dispatch_id, user_decision, user_decision_note,
           user_decision_dispatch_id, payload_json, created_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.sourceDesignMeetingId,
        record.designChannelId,
        record.designChannelRole,
        record.planningChannelId,
        record.implementationChannelId,
        record.requestTitle,
        record.requestBody,
        record.finalDesignMinutesPath,
        record.finalDesignMinutesBody,
        record.snapshotDesktopPath,
        record.snapshotMobilePath,
        record.wireframeCheckpointsJson,
        record.wireframeUserNotesJson,
        record.workBundleKey,
        record.originalPlanningMinutesId,
        record.originalPlanningMinutesPath,
        record.originalPlanningMinutesBody,
        record.originalPlanningMinutesMissingReason,
        record.returnCount,
        record.verdict,
        record.status,
        record.reason,
        record.revisionDirection,
        record.implementationDispatchId,
        record.designReturnDispatchId,
        record.userDecision,
        record.userDecisionNote,
        record.userDecisionDispatchId,
        record.payloadJson,
        record.createdAt,
        record.decidedAt,
      );
  }

  findById(id: string): PlanningDesignCheckRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS_SELECT} FROM planning_design_check WHERE id = ?`)
      .get(id) as PlanningDesignCheckRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  listByProject(projectId: string): PlanningDesignCheckRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM planning_design_check
         WHERE project_id = ?
         ORDER BY created_at DESC, id ASC`,
      )
      .all(projectId) as PlanningDesignCheckRow[];
    return rows.map(rowToRecord);
  }

  countReturnedToDesign(input: {
    projectId: string;
    workBundleKey: string | null;
  }): number {
    if (input.workBundleKey === null || input.workBundleKey.trim().length === 0) {
      return 0;
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM planning_design_check
         WHERE project_id = ?
           AND work_bundle_key = ?
           AND (
             status = 'returned_to_design'
             OR user_decision = 'request_design_revision'
           )`,
      )
      .get(input.projectId, input.workBundleKey) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  findByDesignReturnDispatchId(
    dispatchId: string,
  ): PlanningDesignCheckRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM planning_design_check
         WHERE design_return_dispatch_id = ?
         ORDER BY created_at DESC, id ASC
         LIMIT 1`,
      )
      .get(dispatchId) as PlanningDesignCheckRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  updateResult(input: {
    id: string;
    status: PlanningDesignCheckStatus;
    verdict: PlanningDesignCheckVerdict;
    reason: string | null;
    revisionDirection: string | null;
    returnCount: number;
    payloadJson: string | null;
    decidedAt: number;
  }): PlanningDesignCheckRecord | null {
    const result = this.db
      .prepare(
        `UPDATE planning_design_check
         SET status = ?,
             verdict = ?,
             reason = ?,
             revision_direction = ?,
             return_count = ?,
             payload_json = ?,
             decided_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.verdict,
        input.reason,
        input.revisionDirection,
        input.returnCount,
        input.payloadJson,
        input.decidedAt,
        input.id,
      );
    if (result.changes === 0) return null;
    return this.findById(input.id);
  }

  setImplementationDispatchId(
    id: string,
    dispatchId: string,
  ): PlanningDesignCheckRecord | null {
    const result = this.db
      .prepare(
        `UPDATE planning_design_check
         SET implementation_dispatch_id = ?
         WHERE id = ?`,
      )
      .run(dispatchId, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  setDesignReturnDispatchId(
    id: string,
    dispatchId: string,
  ): PlanningDesignCheckRecord | null {
    const result = this.db
      .prepare(
        `UPDATE planning_design_check
         SET design_return_dispatch_id = ?
         WHERE id = ?`,
      )
      .run(dispatchId, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  recordUserDecision(input: {
    id: string;
    userDecision: PlanningDesignCheckUserDecision;
    userDecisionNote: string | null;
    dispatchId: string | null;
    decidedAt: number;
  }): PlanningDesignCheckRecord | null {
    const result = this.db
      .prepare(
        `UPDATE planning_design_check
         SET user_decision = ?,
             user_decision_note = ?,
             user_decision_dispatch_id = ?,
             decided_at = ?
         WHERE id = ?`,
      )
      .run(
        input.userDecision,
        input.userDecisionNote,
        input.dispatchId,
        input.decidedAt,
        input.id,
      );
    if (result.changes === 0) return null;
    return this.findById(input.id);
  }
}
