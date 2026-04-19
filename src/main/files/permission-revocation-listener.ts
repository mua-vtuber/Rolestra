/**
 * Connects SessionStateMachine permission events to PermissionService.
 *
 * Translates SSM's grant_worker / revoke_worker / revoke_all actions
 * into concrete permission changes on the PermissionService.
 *
 * TODO(R2-Task21): Legacy v2 PermissionService API consumer. The v2
 * getPermissions/setPermissions surface was removed in R2 Task 6 during
 * PermissionService redesign. This listener is compile-fenced with
 * @ts-expect-error markers until Task 21 either ports it to the new
 * path-guard API or deletes it. See
 * docs/superpowers/plans/2026-04-18-rolestra-phase-r2.md §Task 21.
 */

import type { PermissionAction } from '../../shared/session-state-types';
import type { FilePermission } from '../../shared/file-types';
import { DEFAULT_FILE_PERMISSION } from '../../shared/file-types';
import type { SessionStateMachine } from '../engine/session-state-machine';
import type { PermissionService } from './permission-service';

/**
 * Attach a permission revocation listener to a SessionStateMachine.
 *
 * @param ssm - The session state machine emitting permission events.
 * @param permissionService - The service whose permissions will be updated.
 * @returns An unsubscribe function to detach the listener.
 */
export function attachPermissionRevocationListener(
  ssm: SessionStateMachine,
  permissionService: PermissionService,
): () => void {
  return ssm.onPermissionAction((action: PermissionAction) => {
    const projectPath = ssm.projectPath;
    if (!projectPath) return;

    switch (action.type) {
      case 'grant_worker':
        grantWorkerPermissions(permissionService, action.workerId, projectPath);
        break;
      case 'revoke_worker':
        revokeWorkerPermissions(permissionService, action.workerId, projectPath);
        break;
      case 'revoke_all':
        revokeAllPermissions(permissionService, projectPath);
        break;
    }
  });
}

/** Grant read + write + execute to a specific worker. */
function grantWorkerPermissions(
  service: PermissionService,
  workerId: string,
  projectPath: string,
): void {
  // @ts-expect-error R2-Task21: legacy v2 API (getPermissions) removed in Task 6.
  const existing = service.getPermissions();
  const updated = existing.filter((p: FilePermission) => p.participantId !== workerId);
  updated.push({
    participantId: workerId,
    folderPath: projectPath,
    read: true,
    write: true,
    execute: true,
  });
  // @ts-expect-error R2-Task21: legacy v2 API (setPermissions) removed in Task 6.
  service.setPermissions(updated);
}

/** Revoke a specific worker back to read-only (DEFAULT_FILE_PERMISSION). */
function revokeWorkerPermissions(
  service: PermissionService,
  workerId: string,
  projectPath: string,
): void {
  // @ts-expect-error R2-Task21: legacy v2 API (getPermissions) removed in Task 6.
  const existing = service.getPermissions();
  const updated = existing.filter((p: FilePermission) => p.participantId !== workerId);
  updated.push({
    participantId: workerId,
    folderPath: projectPath,
    ...DEFAULT_FILE_PERMISSION,
  });
  // @ts-expect-error R2-Task21: legacy v2 API (setPermissions) removed in Task 6.
  service.setPermissions(updated);
}

/** Revoke all participants back to read-only. */
function revokeAllPermissions(
  service: PermissionService,
  projectPath: string,
): void {
  // @ts-expect-error R2-Task21: legacy v2 API (getPermissions) removed in Task 6.
  const existing = service.getPermissions();
  const participantIds = new Set(existing.map((p: FilePermission) => p.participantId));
  const updated: FilePermission[] = [];
  for (const id of participantIds) {
    updated.push({
      participantId: id as string,
      folderPath: projectPath,
      ...DEFAULT_FILE_PERMISSION,
    });
  }
  // @ts-expect-error R2-Task21: legacy v2 API (setPermissions) removed in Task 6.
  service.setPermissions(updated);
}
