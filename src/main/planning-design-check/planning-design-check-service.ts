import { randomUUID } from 'node:crypto';
import type { ChannelRole } from '../../shared/channel-role-types';
import type {
  PlanningDesignCheckRecord,
  PlanningDesignCheckStatus,
  PlanningDesignCheckUserDecision,
  PlanningDesignCheckVerdict,
  PlanningDesignCheckWireframeRecord,
} from '../../shared/planning-design-check-types';
import type { DesignCheckpointService } from '../design-checkpoints/design-checkpoint-service';
import type { PlanningDesignCheckRepository } from './planning-design-check-repository';

export class PlanningDesignCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningDesignCheckError';
  }
}

export class PlanningDesignCheckNotFoundError extends PlanningDesignCheckError {
  constructor(id: string) {
    super(`PlanningDesignCheck not found: ${id}`);
    this.name = 'PlanningDesignCheckNotFoundError';
  }
}

export interface CreatePlanningDesignCheckRequestInput {
  projectId: string;
  sourceDesignMeetingId: string;
  designChannelId: string;
  designChannelRole: ChannelRole;
  planningChannelId: string;
  implementationChannelId: string | null;
  finalDesignMinutesPath: string;
  finalDesignMinutesBody: string;
  workBundleKey?: string | null;
  originalPlanningMinutesId?: string | null;
  originalPlanningMinutesPath?: string | null;
  originalPlanningMinutesBody?: string | null;
  originalPlanningMinutesMissingReason?: string | null;
  snapshotDesktopPath?: string | null;
  snapshotMobilePath?: string | null;
  payloadJson?: string | null;
  returnCount?: number;
}

export interface RecordPlanningDesignCheckResultInput {
  id: string;
  verdict: PlanningDesignCheckVerdict;
  reason?: string | null;
  revisionDirection?: string | null;
  payloadJson?: string | null;
}

export interface RecordPlanningDesignCheckUserDecisionInput {
  id: string;
  decision: PlanningDesignCheckUserDecision;
  userNote?: string | null;
  dispatchId?: string | null;
}

export interface MisalignedPlanningDesignCheckResult {
  record: PlanningDesignCheckRecord;
  action: 'return_to_design' | 'needs_user_decision';
}

export class PlanningDesignCheckService {
  constructor(
    private readonly repo: PlanningDesignCheckRepository,
    private readonly checkpointService: DesignCheckpointService,
    private readonly now: () => number = Date.now,
  ) {}

  withTransaction<T>(fn: () => T): T {
    return this.repo.withTransaction(fn);
  }

  createRequest(
    input: CreatePlanningDesignCheckRequestInput,
  ): PlanningDesignCheckRecord {
    const wireframeCheckpoints = this.checkpointService
      .listForDesignCheckRequest({
        projectId: input.projectId,
        meetingId: input.sourceDesignMeetingId,
      })
      .map<PlanningDesignCheckWireframeRecord>((checkpoint) => ({
        id: checkpoint.id,
        status: checkpoint.status,
        title: checkpoint.title,
        documentPath: checkpoint.documentPath,
        userNote: checkpoint.userNote,
        decidedAt: checkpoint.decidedAt,
      }));
    const wireframeUserNotes = wireframeCheckpoints
      .filter(
        (checkpoint) =>
          checkpoint.status === 'revision_requested' &&
          checkpoint.userNote !== null,
      )
      .map((checkpoint) => ({
        checkpointId: checkpoint.id,
        userNote: checkpoint.userNote,
      }));
    const returnCount =
      input.returnCount ??
      this.repo.countReturnedToDesign({
        projectId: input.projectId,
        workBundleKey: input.workBundleKey ?? null,
      });
    const requestBody = buildRequestBody({
      originalPlanningMinutesId: input.originalPlanningMinutesId ?? null,
      originalPlanningMinutesPath: input.originalPlanningMinutesPath ?? null,
      originalPlanningMinutesBody: input.originalPlanningMinutesBody ?? null,
      originalPlanningMinutesMissingReason:
        input.originalPlanningMinutesMissingReason ?? null,
      finalDesignMinutesPath: input.finalDesignMinutesPath,
      finalDesignMinutesBody: input.finalDesignMinutesBody,
      snapshotDesktopPath: input.snapshotDesktopPath ?? null,
      snapshotMobilePath: input.snapshotMobilePath ?? null,
      wireframeCheckpoints,
      wireframeUserNotes,
      returnCount,
    });
    const record: PlanningDesignCheckRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      sourceDesignMeetingId: input.sourceDesignMeetingId,
      designChannelId: input.designChannelId,
      designChannelRole: input.designChannelRole,
      planningChannelId: input.planningChannelId,
      implementationChannelId: input.implementationChannelId,
      requestTitle: '디자인 검수 요청서',
      requestBody,
      finalDesignMinutesPath: input.finalDesignMinutesPath,
      finalDesignMinutesBody: input.finalDesignMinutesBody,
      snapshotDesktopPath: input.snapshotDesktopPath ?? null,
      snapshotMobilePath: input.snapshotMobilePath ?? null,
      wireframeCheckpointsJson: JSON.stringify(wireframeCheckpoints),
      wireframeUserNotesJson: JSON.stringify(wireframeUserNotes),
      workBundleKey: input.workBundleKey ?? null,
      originalPlanningMinutesId: input.originalPlanningMinutesId ?? null,
      originalPlanningMinutesPath: input.originalPlanningMinutesPath ?? null,
      originalPlanningMinutesBody: input.originalPlanningMinutesBody ?? null,
      originalPlanningMinutesMissingReason:
        input.originalPlanningMinutesMissingReason ?? null,
      returnCount,
      verdict: null,
      status: 'request_created',
      reason: null,
      revisionDirection: null,
      implementationDispatchId: null,
      designReturnDispatchId: null,
      userDecision: null,
      userDecisionNote: null,
      userDecisionDispatchId: null,
      payloadJson: input.payloadJson ?? null,
      createdAt: this.now(),
      decidedAt: null,
    };
    this.repo.insert(record);
    return record;
  }

  get(id: string): PlanningDesignCheckRecord {
    const record = this.repo.findById(id);
    if (record === null) throw new PlanningDesignCheckNotFoundError(id);
    return record;
  }

  listByProject(projectId: string): PlanningDesignCheckRecord[] {
    return this.repo.listByProject(projectId);
  }

  findByDesignReturnDispatchId(
    dispatchId: string,
  ): PlanningDesignCheckRecord | null {
    return this.repo.findByDesignReturnDispatchId(dispatchId);
  }

  recordAligned(
    input: Omit<RecordPlanningDesignCheckResultInput, 'verdict'>,
  ): PlanningDesignCheckRecord {
    return this.updateResult({
      id: input.id,
      verdict: 'aligned',
      status: 'aligned',
      reason: normalizeNullable(input.reason),
      revisionDirection: null,
      returnCount: this.get(input.id).returnCount,
      payloadJson: this.mergePayload(input.id, input.payloadJson),
    });
  }

  recordMisaligned(
    input: Omit<RecordPlanningDesignCheckResultInput, 'verdict'>,
  ): MisalignedPlanningDesignCheckResult {
    const before = this.get(input.id);
    const shouldReturn = before.returnCount < 1;
    const status: PlanningDesignCheckStatus = shouldReturn
      ? 'returned_to_design'
      : 'needs_user_decision';
    const nextReturnCount = shouldReturn
      ? before.returnCount + 1
      : before.returnCount;
    const record = this.updateResult({
      id: input.id,
      verdict: 'misaligned',
      status,
      reason: normalizeNullable(input.reason),
      revisionDirection: normalizeNullable(input.revisionDirection),
      returnCount: nextReturnCount,
      payloadJson: this.mergePayload(input.id, input.payloadJson),
    });
    return {
      record,
      action: shouldReturn ? 'return_to_design' : 'needs_user_decision',
    };
  }

  recordNeedsUserDecision(input: {
    id: string;
    reason?: string | null;
    payloadJson?: string | null;
  }): PlanningDesignCheckRecord {
    const before = this.get(input.id);
    return this.updateResult({
      id: input.id,
      verdict: before.verdict ?? 'needs_user_decision',
      status: 'needs_user_decision',
      reason: normalizeNullable(input.reason),
      revisionDirection: before.revisionDirection,
      returnCount: before.returnCount,
      payloadJson: this.mergePayload(input.id, input.payloadJson),
    });
  }

  recordUserDecision(
    input: RecordPlanningDesignCheckUserDecisionInput,
  ): PlanningDesignCheckRecord {
    const updated = this.repo.recordUserDecision({
      id: input.id,
      userDecision: input.decision,
      userDecisionNote: normalizeNullable(input.userNote),
      dispatchId: input.dispatchId ?? null,
      decidedAt: this.now(),
    });
    if (updated === null) throw new PlanningDesignCheckNotFoundError(input.id);
    return updated;
  }

  setImplementationDispatchId(
    id: string,
    dispatchId: string,
  ): PlanningDesignCheckRecord {
    const updated = this.repo.setImplementationDispatchId(id, dispatchId);
    if (updated === null) throw new PlanningDesignCheckNotFoundError(id);
    return updated;
  }

  setDesignReturnDispatchId(
    id: string,
    dispatchId: string,
  ): PlanningDesignCheckRecord {
    const updated = this.repo.setDesignReturnDispatchId(id, dispatchId);
    if (updated === null) throw new PlanningDesignCheckNotFoundError(id);
    return updated;
  }

  private updateResult(input: {
    id: string;
    verdict: PlanningDesignCheckVerdict;
    status: PlanningDesignCheckStatus;
    reason: string | null;
    revisionDirection: string | null;
    returnCount: number;
    payloadJson: string | null;
  }): PlanningDesignCheckRecord {
    const updated = this.repo.updateResult({
      ...input,
      decidedAt: this.now(),
    });
    if (updated === null) throw new PlanningDesignCheckNotFoundError(input.id);
    return updated;
  }

  private mergePayload(id: string, patchJson: string | null | undefined): string | null {
    const before = this.get(id).payloadJson;
    if (patchJson === undefined || patchJson === null) return before;
    if (before === null) return patchJson;
    try {
      const beforeValue = JSON.parse(before) as unknown;
      const patchValue = JSON.parse(patchJson) as unknown;
      if (
        typeof beforeValue === 'object' &&
        beforeValue !== null &&
        !Array.isArray(beforeValue) &&
        typeof patchValue === 'object' &&
        patchValue !== null &&
        !Array.isArray(patchValue)
      ) {
        return JSON.stringify({ ...beforeValue, ...patchValue });
      }
    } catch {
      return patchJson;
    }
    return patchJson;
  }
}

function buildRequestBody(input: {
  originalPlanningMinutesId: string | null;
  originalPlanningMinutesPath: string | null;
  originalPlanningMinutesBody: string | null;
  originalPlanningMinutesMissingReason: string | null;
  finalDesignMinutesPath: string;
  finalDesignMinutesBody: string;
  snapshotDesktopPath: string | null;
  snapshotMobilePath: string | null;
  wireframeCheckpoints: PlanningDesignCheckWireframeRecord[];
  wireframeUserNotes: Array<{ checkpointId: string; userNote: string | null }>;
  returnCount: number;
}): string {
  const lines: string[] = [];
  lines.push('# 디자인 검수 요청서');
  lines.push('');
  lines.push(`되돌림 횟수: ${input.returnCount}`);
  lines.push('');
  lines.push('## 원래 기획 회의록');
  if (
    input.originalPlanningMinutesBody !== null &&
    input.originalPlanningMinutesPath !== null
  ) {
    if (input.originalPlanningMinutesId !== null) {
      lines.push(`회의 ID: ${input.originalPlanningMinutesId}`);
    }
    lines.push(`경로: ${input.originalPlanningMinutesPath}`);
    lines.push('');
    lines.push(input.originalPlanningMinutesBody);
  } else {
    lines.push(
      `찾지 못함: ${
        input.originalPlanningMinutesMissingReason ??
        '원래 기획 회의록 컨텍스트가 없습니다.'
      }`,
    );
  }
  lines.push('');
  lines.push('## 최종 디자인 산출물');
  lines.push(`최종 디자인 회의록: ${input.finalDesignMinutesPath}`);
  if (input.snapshotDesktopPath !== null) {
    lines.push(`데스크톱 스냅샷: ${input.snapshotDesktopPath}`);
  }
  if (input.snapshotMobilePath !== null) {
    lines.push(`모바일 스냅샷: ${input.snapshotMobilePath}`);
  }
  lines.push('');
  lines.push('## 와이어프레임 확인 기록');
  if (input.wireframeCheckpoints.length === 0) {
    lines.push('(기록 없음)');
  } else {
    for (const checkpoint of input.wireframeCheckpoints) {
      lines.push(
        `- ${checkpoint.title}: ${checkpoint.status}` +
          (checkpoint.userNote !== null ? ` — ${checkpoint.userNote}` : ''),
      );
    }
  }
  lines.push('');
  lines.push('## 사용자 와이어프레임 수정 지시');
  if (input.wireframeUserNotes.length === 0) {
    lines.push('(없음)');
  } else {
    for (const note of input.wireframeUserNotes) {
      lines.push(`- ${note.userNote ?? ''}`);
    }
  }
  lines.push('');
  lines.push('## 최종 디자인 회의록 본문');
  lines.push(input.finalDesignMinutesBody);
  return lines.join('\n');
}

function normalizeNullable(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}
