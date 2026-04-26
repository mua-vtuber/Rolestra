/**
 * IPC handlers for execution channels.
 *
 * Bridges IPC to the ExecutionService for dry-run preview and patch approval.
 * Maintains a map of pending PatchSets awaiting user approval.
 */

import type { WebContents } from 'electron';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { DiffEntry, PatchSet } from '../../../shared/execution-types';
import { ExecutionService } from '../../execution/execution-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import type { ApprovalService } from '../../approvals/approval-service';
import { setAuditLogAccessor } from './audit-handler';

/**
 * The execution service is created lazily when the workspace root is known.
 * It requires a workspace root to enforce path boundary validation.
 */
let executionService: ExecutionService | null = null;
let rendererWebContents: WebContents | null = null;

/**
 * R9-Task6: CircuitBreaker remembered across `setExecutionWorkspaceRoot`
 * invocations. `main/index.ts` registers the boot-time breaker once via
 * {@link setExecutionCircuitBreaker}; workspace init (which rebuilds the
 * ExecutionService with a fresh workspace root) threads the same instance
 * into the new service so `files_per_turn` keeps accumulating across
 * workspace switches.
 */
let cachedCircuitBreaker: CircuitBreaker | null = null;

/** Set the renderer WebContents reference for push events. */
export function setExecutionWebContents(wc: WebContents): void {
  rendererWebContents = wc;
}

/**
 * Register the CircuitBreaker that every ExecutionService built via
 * {@link setExecutionWorkspaceRoot} will receive. Called once at boot
 * by `main/index.ts`. Subsequent workspace init IPC calls pick it up
 * automatically without re-threading the reference through the
 * workspace-handler call chain.
 */
export function setExecutionCircuitBreaker(
  breaker: CircuitBreaker | null,
): void {
  cachedCircuitBreaker = breaker;
}

/** Set (or reset) the workspace root for execution service path validation. */
export function setExecutionWorkspaceRoot(
  workspaceRoot: string,
  ensureAccess?: (
    aiId: string,
    action: 'read' | 'write' | 'execute',
    targetPath: string,
    conversationId?: string,
  ) => Promise<boolean>,
  circuitBreaker?: CircuitBreaker,
): void {
  const svc = new ExecutionService({
    workspaceRoot,
    ensureAccess,
    circuitBreaker: circuitBreaker ?? cachedCircuitBreaker ?? undefined,
  });
  executionService = svc;
  // Capture the fresh local reference so the accessor closure holds a
  // non-null ExecutionService. Using `executionService` directly would
  // force a `!` assertion (ESLint no-non-null-assertion) because the
  // module-level binding is typed `| null`.
  setAuditLogAccessor(() => svc.getAuditLog());
}

function getExecutionService(): ExecutionService {
  if (!executionService) {
    throw new Error('ExecutionService not initialized: workspace root not set');
  }
  return executionService;
}

/** Pending patch sets awaiting user approval, keyed by operationId. */
const pendingPatches = new Map<string, { patchSet: PatchSet; diffs: DiffEntry[] }>();

/** Clear all pending patches (called on session end / cleanup). */
export function clearPendingPatches(): void {
  pendingPatches.clear();
}

/**
 * Submit a patch set for preview and later approval.
 * Called internally by the orchestrator/AI when proposing file changes.
 * NOT exposed via IPC — the orchestrator calls this directly.
 */
export function submitPatchForReview(patchSet: PatchSet, conversationId?: string): { operationId: string; diffs: DiffEntry[] } {
  const diffs = getExecutionService().generateDiff(patchSet);
  pendingPatches.set(patchSet.operationId, { patchSet, diffs });

  // Push event to renderer so it doesn't need to poll
  if (rendererWebContents && !rendererWebContents.isDestroyed()) {
    rendererWebContents.send('stream:execution-pending', {
      conversationId: conversationId ?? '',
      operationId: patchSet.operationId,
      diffs,
    });
  }

  return { operationId: patchSet.operationId, diffs };
}

/**
 * execution:preview — retrieve diffs for a pending operation by ID.
 */
export function handleExecutionPreview(
  data: IpcRequest<'execution:preview'>,
): IpcResponse<'execution:preview'> {
  const pending = pendingPatches.get(data.operationId);
  if (!pending) {
    throw new Error(`No pending operation found: ${data.operationId}`);
  }
  return { diffs: pending.diffs };
}

/**
 * execution:list-pending — list all pending patch sets with their diffs.
 */
export function handleExecutionListPending(): IpcResponse<'execution:list-pending'> {
  const operations = Array.from(pendingPatches.entries()).map(([operationId, entry]) => ({
    operationId,
    diffs: entry.diffs,
  }));
  return { operations };
}

/**
 * execution:approve — apply a pending patch set.
 */
export async function handleExecutionApprove(
  data: IpcRequest<'execution:approve'>,
): Promise<IpcResponse<'execution:approve'>> {
  const pending = pendingPatches.get(data.operationId);
  if (!pending) {
    return { success: false, error: `No pending patch: ${data.operationId}` };
  }

  const applySet: PatchSet = { ...pending.patchSet, dryRun: false };
  const result = await getExecutionService().applyPatch(applySet);

  if (result.success) {
    pendingPatches.delete(data.operationId);
  }

  // R11-Task2: v2 ConversationOrchestrator.resolveExecutionApproval was
  // dropped along with the v2 engine. The v3 path routes execution
  // approvals through ApprovalService (`approval:decide`); this v2 IPC
  // surface remains only as a fallback for any caller that still talks
  // to it directly during the migration window.
  return { success: result.success, error: result.error };
}

/**
 * execution:reject — discard a pending patch set.
 */
export function handleExecutionReject(
  data: IpcRequest<'execution:reject'>,
): IpcResponse<'execution:reject'> {
  const deleted = pendingPatches.delete(data.operationId);

  // R11-Task2: v2 orchestrator notification path removed (see notes in
  // handleExecutionApprove).
  return { success: deleted };
}

// ── R11-Task7: dryRunPreview accessor wiring ──────────────────────────

/**
 * The `execution:dry-run-preview` channel needs an ApprovalService accessor
 * to look up the row keyed by `approvalId`. The approval-handler already
 * owns the canonical accessor (`setApprovalServiceAccessor`); we mirror the
 * same callback here so wiring stays an optional op — boot-time wiring
 * sets both sides; tests can stub one without the other.
 */
let approvalServiceAccessor: (() => ApprovalService) | null = null;

export function setExecutionApprovalServiceAccessor(
  fn: () => ApprovalService,
): void {
  approvalServiceAccessor = fn;
}

/**
 * execution:dry-run-preview — read-only projection of an approval into
 * impacted files + diff preview (R11-Task7). Resolves the `approvalId`
 * via the ApprovalService accessor and forwards to
 * `ExecutionService.dryRunPreview`. The handler returns `{impactedFiles,
 * diffPreviews}` directly per the wire contract — never mutates state.
 */
export async function handleExecutionDryRunPreview(
  data: IpcRequest<'execution:dry-run-preview'>,
): Promise<IpcResponse<'execution:dry-run-preview'>> {
  if (approvalServiceAccessor === null) {
    throw new Error(
      'execution handler: approval service accessor not initialized',
    );
  }
  const approval = approvalServiceAccessor().get(data.approvalId);
  if (approval === null) {
    throw new Error(`approval not found: ${data.approvalId}`);
  }
  const preview = await getExecutionService().dryRunPreview(approval);
  return preview;
}
