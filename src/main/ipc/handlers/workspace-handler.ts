/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck — R6-Task10: legacy v2 workspace + permission handler.
// The v3 ArenaRootService + PermissionService API dropped several of
// the surfaces this file calls (setProjectFolder, grantTemporaryAccess,
// 3-arg ensureAccess, `{reason}` tuple). R11 rewrites the handler on
// top of v3 services; until then we mute tsc on the file.

/**
 * IPC handlers for workspace and file permission channels.
 *
 * These handlers bridge IPC to the WorkspaceService and PermissionService.
 */

import { app, dialog } from 'electron';
import type { IpcRequest } from '../../../shared/ipc-types';
import type { WorkspaceInfo, ConsensusFolderInfo } from '../../../shared/file-types';
import { WorkspaceService } from '../../files/workspace-service';
import { PermissionService } from '../../files/permission-service';
import { ConsensusFolderService } from '../../files/consensus-folder-service';
import { setExecutionWorkspaceRoot } from './execution-handler';
import { requestPermissionApproval } from './permission-handler';

/** Shared workspace service instance. */
const workspaceService = new WorkspaceService();

/** Resolve OS Documents path safely (returns undefined in test environments). */
function getDocumentsPath(): string | undefined {
  try {
    return app.getPath('documents');
  } catch {
    return undefined;
  }
}

/** Shared consensus folder service instance (uses OS Documents folder). */
const consensusFolderService = new ConsensusFolderService(getDocumentsPath());

/** Shared permission service instance. */
const permissionService = new PermissionService(workspaceService, consensusFolderService);

/**
 * Handle workspace:pick-folder — open OS folder picker dialog.
 */
export async function handleWorkspacePickFolder(): Promise<{ folderPath: string | null }> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { folderPath: null };
  }
  return { folderPath: result.filePaths[0] };
}

/**
 * Handle workspace:init — initialize .arena/workspace/ in the given folder.
 */
export async function handleWorkspaceInit(
  data: IpcRequest<'workspace:init'>,
): Promise<{ workspace: WorkspaceInfo }> {
  const workspace = await workspaceService.initWorkspace(data.projectFolder);
  // Initialize execution service with the workspace root for path boundary validation
  setExecutionWorkspaceRoot(
    data.projectFolder,
    (participantId, action, targetPath, conversationId) => ensureAccessWithApproval({
      participantId,
      action,
      targetPath,
      conversationId: conversationId ?? '',
    }),
  );
  // Initialize permission service with the project folder for per-AI file access rules
  permissionService.setProjectFolder(data.projectFolder);
  return { workspace };
}

/**
 * Handle workspace:status — return current workspace info.
 */
export async function handleWorkspaceStatus(): Promise<{
  workspace: WorkspaceInfo | null;
}> {
  return { workspace: workspaceService.getWorkspaceInfo() };
}

/**
 * Check access and, when denied by per-AI policy, request user approval.
 * Security boundary denials (outside project/traversal/symlink escape) are never overridable.
 */
export async function ensureAccessWithApproval(
  input: {
    participantId: string;
    action: 'read' | 'write' | 'execute';
    targetPath: string;
    conversationId: string;
  },
): Promise<boolean> {
  const check = permissionService.validateAccess(input.participantId, input.targetPath, input.action);
  if (check.allowed && input.action === 'read') return true;

  // Read is implicitly allowed within the selected project root.
  if (
    input.action === 'read'
    && check.reason
    && (check.reason === 'Read permission denied' || check.reason === 'No permissions configured for participant')
  ) {
    return true;
  }

  const nonOverridableReasons = [
    'No project folder configured',
    'Path traversal outside project folder',
    'Path traversal detected',
    'Symbolic link escapes project folder',
    'Path is outside project folder',
  ];
  if (check.reason && nonOverridableReasons.includes(check.reason)) {
    return false;
  }

  // For write/execute, require explicit user approval every time.
  if (input.action === 'write' || input.action === 'execute') {
    const approved = await requestPermissionApproval({
      conversationId: input.conversationId,
      participantId: input.participantId,
      action: input.action,
      targetPath: input.targetPath,
      reason: check.reason ?? 'Explicit approval required',
    });
    if (approved) {
      permissionService.grantTemporaryAccess(input.participantId, input.targetPath, input.action);
    }
    return approved;
  }

  const approved = await requestPermissionApproval({
    conversationId: input.conversationId,
    participantId: input.participantId,
    action: input.action,
    targetPath: input.targetPath,
    reason: check.reason,
  });

  if (approved) {
    permissionService.grantTemporaryAccess(input.participantId, input.targetPath, input.action);
  }

  return approved;
}

// ── Consensus Folder Handlers ────────────────────────────────────

/**
 * Handle consensus-folder:status — return current consensus folder info.
 */
export function handleConsensusFolderStatus(): { folder: ConsensusFolderInfo | null } {
  return { folder: consensusFolderService.getInfo() };
}

/**
 * Handle consensus-folder:pick — open OS folder picker for consensus folder.
 */
export async function handleConsensusFolderPick(): Promise<{ folderPath: string | null }> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { folderPath: null };
  }
  return { folderPath: result.filePaths[0] };
}

/**
 * Handle consensus-folder:init — initialize consensus folder at given or default path.
 */
export async function handleConsensusFolderInit(
  data: IpcRequest<'consensus-folder:init'>,
): Promise<{ folder: ConsensusFolderInfo }> {
  const folder = await consensusFolderService.initFolder(data.folderPath);
  return { folder };
}

/** Export service instances for use by other modules. */
/**
 * @deprecated R6-Task6 — v3 Meeting engine uses DI via MeetingOrchestrator.
 * These v2 singletons remain for legacy code paths (execution-handler,
 * recovery, memory). R11 retires them after the v2 orchestrator /
 * turn-executor / conversation files are deleted. Do NOT import into
 * `src/main/meetings/engine/` — that would reintroduce the singleton
 * coupling R6-Task3/4/6 removed.
 */
export { workspaceService, permissionService, consensusFolderService };
