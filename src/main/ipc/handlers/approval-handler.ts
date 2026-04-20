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

let approvalAccessor: (() => ApprovalService) | null = null;

export function setApprovalServiceAccessor(
  fn: () => ApprovalService,
): void {
  approvalAccessor = fn;
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
