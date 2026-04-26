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
import type { ApprovalConsensusContext } from '../../../shared/approval-detail-types';
import {
  emptyConsensusContext,
  extractConsensusContext,
} from '../../meetings/voting-history';

let approvalAccessor: (() => ApprovalService) | null = null;
let executionAccessor: (() => ExecutionService) | null = null;
let meetingAccessor: (() => MeetingService) | null = null;

export function setApprovalServiceAccessor(
  fn: () => ApprovalService,
): void {
  approvalAccessor = fn;
}

/**
 * R11-Task7: approval:detail-fetch composes ExecutionService.dryRunPreview
 * + meetings/voting-history into a single round-trip. Both deps are
 * optional in tests — when an accessor is null the handler treats the
 * affected slice as empty (preview = empty arrays / consensus = null).
 */
export function setApprovalDetailExecutionAccessor(
  fn: () => ExecutionService,
): void {
  executionAccessor = fn;
}

export function setApprovalDetailMeetingAccessor(
  fn: () => MeetingService,
): void {
  meetingAccessor = fn;
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

  // Slice 2 — voting context. Only resolves when the approval names a
  // meeting; otherwise the panel hides the votes card.
  let consensusContext: ApprovalConsensusContext | null = null;
  if (approval.meetingId !== null && meetingAccessor !== null) {
    try {
      const meeting = meetingAccessor().get(approval.meetingId);
      consensusContext =
        meeting === null
          ? emptyConsensusContext(approval.meetingId)
          : extractConsensusContext(meeting);
    } catch (err) {
      console.warn(
        '[approval-handler] meeting lookup threw:',
        err instanceof Error ? err.message : String(err),
      );
      consensusContext = emptyConsensusContext(approval.meetingId);
    }
  }

  return {
    detail: {
      approval,
      impactedFiles,
      diffPreviews,
      consensusContext,
    },
  };
}
