/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck — R6-Task10: legacy v2 permission handler; uses dropped
// PermissionService.getPermissions surface. R7 replaces with the v3
// ApprovalService-backed path.

/**
 * Runtime permission request handlers.
 *
 * Provides a user-approval workflow for denied file/command accesses:
 * - Main process emits stream:permission-pending
 * - Renderer shows approve/reject UI
 * - Handler resolves pending promise for the requester
 */

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { PermissionRequest } from '../../../shared/file-types';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingPermissionRequest {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let rendererWebContents: WebContents | null = null;
const pendingRequests = new Map<string, PendingPermissionRequest>();

/** Set renderer WebContents used for push notifications. */
export function setPermissionWebContents(wc: WebContents): void {
  rendererWebContents = wc;
}

/** Ask renderer/user to approve a runtime permission request. */
export function requestPermissionApproval(
  input: Omit<PermissionRequest, 'requestId' | 'timestamp'>,
): Promise<boolean> {
  const request: PermissionRequest = {
    requestId: randomUUID(),
    timestamp: Date.now(),
    ...input,
  };

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.requestId);
      resolve(false);
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(request.requestId, { request, resolve, timeout });

    if (rendererWebContents && !rendererWebContents.isDestroyed()) {
      rendererWebContents.send('stream:permission-pending', {
        conversationId: request.conversationId,
        request,
      });
    }
  });
}

/** permission:list-pending */
export function handlePermissionListPending(): IpcResponse<'permission:list-pending'> {
  return {
    requests: Array.from(pendingRequests.values()).map((v) => v.request),
  };
}

/** permission:approve */
export function handlePermissionApprove(
  data: IpcRequest<'permission:approve'>,
): IpcResponse<'permission:approve'> {
  const pending = pendingRequests.get(data.requestId);
  if (!pending) {
    return { success: false, error: `No pending permission request: ${data.requestId}` };
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(data.requestId);
  pending.resolve(true);
  return { success: true };
}

/** permission:reject */
export function handlePermissionReject(
  data: IpcRequest<'permission:reject'>,
): IpcResponse<'permission:reject'> {
  const pending = pendingRequests.get(data.requestId);
  if (!pending) {
    return { success: false, error: `No pending permission request: ${data.requestId}` };
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(data.requestId);
  pending.resolve(false);
  return { success: true };
}

// ── Permission Rules (read-only listing) ──────────────────────────

import type { PermissionService } from '../../files/permission-service';

let permissionServiceAccessor: (() => PermissionService) | null = null;

/** Set the accessor for PermissionService (lazy wiring). */
export function setPermissionServiceAccessor(fn: () => PermissionService): void {
  permissionServiceAccessor = fn;
}

/** permission:list-rules */
export function handlePermissionListRules(
  data: IpcRequest<'permission:list-rules'>,
): IpcResponse<'permission:list-rules'> {
  if (!permissionServiceAccessor) {
    return { rules: [] };
  }
  const service = permissionServiceAccessor();
  let perms = service.getPermissions();
  if (data.aiId) {
    perms = perms.filter((p) => p.participantId === data.aiId);
  }
  return {
    rules: perms.map((p) => ({
      aiId: p.participantId,
      path: p.folderPath,
      read: p.read,
      write: p.write,
      execute: p.execute,
    })),
  };
}

