/**
 * approval:* IPC handlers.
 *
 * Wrap {@link ApprovalService} for the 2-endpoint IPC contract
 * (`approval:list` + `approval:decide`). `create`, `expire`, and
 * `supersede` are deliberately not exposed — approvals are created by
 * system flows (CLI permission, consensus, failure, mode transition)
 * and lifecycle-transitioned by the engine. Only the user's "decide"
 * gesture crosses IPC.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ApprovalService } from '../../approvals/approval-service';
import type { ExecutionService } from '../../execution/execution-service';
import type { MeetingService } from '../../meetings/meeting-service';

let approvalAccessor: (() => ApprovalService) | null = null;
let executionAccessor: (() => ExecutionService) | null = null;

export function setApprovalServiceAccessor(
  fn: () => ApprovalService,
): void {
  approvalAccessor = fn;
}

/**
 * R11-Task7: approval:detail-fetch composes ExecutionService.dryRunPreview
 * into a round-trip. Accessor is optional in tests — when null the handler
 * treats the preview slice as empty.
 *
 * R12-C2 T10b: 옛 voting-history 합치기 제거됨 — SSM 투표 snapshot 데이터
 * 소스가 폐기되어 consensusContext 는 항상 null 로 떨어진다.
 */
export function setApprovalDetailExecutionAccessor(
  fn: () => ExecutionService,
): void {
  executionAccessor = fn;
}

/**
 * R12-C2 T10b: 본 setter 는 historical caller (main/index.ts + 테스트) 호환을
 * 위해 보존하지만 인자는 무시된다 — voting-history 흐름이 폐기되어 본
 * 핸들러가 더 이상 MeetingService 에 접근하지 않는다.
 */
export function setApprovalDetailMeetingAccessor(
  _fn: () => MeetingService,
): void {
  // no-op
}

function getService(): ApprovalService {
  if (!approvalAccessor) {
    throw new Error('approval handler: service not initialized');
  }
  return approvalAccessor();
}

/** approval:list */
export function handleApprovalList(
  data: IpcRequest<'approval:list'>,
): IpcResponse<'approval:list'> {
  const items = getService().list({
    status: data?.status,
    projectId: data?.projectId,
  });
  return { items };
}

/** approval:decide */
export function handleApprovalDecide(
  data: IpcRequest<'approval:decide'>,
): IpcResponse<'approval:decide'> {
  getService().decide(data.id, data.decision, data.comment);
  return { success: true };
}

/**
 * F6-T1: approval:count — three status buckets + the union as `all`,
 * scoped by optional `projectId`. Each `count` call is a single
 * `COUNT(*)` SQL query so 4 buckets cost 4 raw counts (no JSON parse,
 * no row materialisation). The renderer's `ApprovalInboxView` calls
 * this once per filter switch to populate the tab badges.
 *
 * `expired` / `superseded` rows are excluded from `all` because they
 * are retirement transitions, not user-facing decisions; the inbox UI
 * never surfaces them as a tab.
 */
export function handleApprovalCount(
  data: IpcRequest<'approval:count'>,
): IpcResponse<'approval:count'> {
  const service = getService();
  const projectId = data?.projectId;
  const pending = service.count({ status: 'pending', projectId });
  const approved = service.count({ status: 'approved', projectId });
  const rejected = service.count({ status: 'rejected', projectId });
  return {
    pending,
    approved,
    rejected,
    all: pending + approved + rejected,
  };
}

/**
 * R11-Task7: approval:detail-fetch — single round-trip combining
 * (i) the approval row, (ii) ExecutionService dry-run preview, and (iii)
 * meeting voting context. Each slice is independent so a meeting lookup
 * miss does not abort the preview, and an execution accessor miss does
 * not abort the consensus context. Both empty cases produce a renderer-
 * safe zero-state.
 */
export async function handleApprovalDetailFetch(
  data: IpcRequest<'approval:detail-fetch'>,
): Promise<IpcResponse<'approval:detail-fetch'>> {
  const approval = getService().get(data.approvalId);
  if (approval === null) {
    throw new Error(`approval not found: ${data.approvalId}`);
  }

  // Slice 1 — dry-run preview. Missing accessor or per-call throw both
  // collapse to empty arrays (the row still renders without preview).
  let impactedFiles = [] as Awaited<
    ReturnType<ExecutionService['dryRunPreview']>
  >['impactedFiles'];
  let diffPreviews = [] as Awaited<
    ReturnType<ExecutionService['dryRunPreview']>
  >['diffPreviews'];
  if (executionAccessor !== null) {
    try {
      const preview = await executionAccessor().dryRunPreview(approval);
      impactedFiles = preview.impactedFiles;
      diffPreviews = preview.diffPreviews;
    } catch (err) {
      console.warn(
        '[approval-handler] dryRunPreview threw:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Slice 2 — voting context. R12-C2 T10b: SSM 투표 snapshot 흐름 폐기로
  // 항상 null. 새 의견 모델 표결 surface 는 P3/R12-H 에서 별도 IPC 로 재정의.
  return {
    detail: {
      approval,
      impactedFiles,
      diffPreviews,
      consensusContext: null,
    },
  };
}
