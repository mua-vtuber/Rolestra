/**
 * PermissionService enforces per-AI file access control within a project.
 *
 * Security invariants:
 * 1. Paths are resolved to absolute form before any check.
 * 2. Symbolic links are dereferenced via fs.realpathSync to prevent escapes.
 * 3. .arena/workspace/ paths are automatically allowed for all participants.
 * 3b. Consensus folder paths are automatically allowed (read & write) for all participants.
 * 4. Paths outside the project folder are always denied.
 * 5. Path traversal via ".." is explicitly blocked.
 * 6. Per-participant read/write/execute flags are enforced.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccessCheckResult, FilePermission } from '../../shared/file-types';
import type { WorkspaceService } from './workspace-service';
import type { ConsensusFolderService } from './consensus-folder-service';

export class PermissionService {
  private permissions: FilePermission[] = [];
  private projectFolder: string | null = null;
  private temporaryGrants = new Map<string, number>();

  /**
   * @param workspaceService - Used to determine arena workspace boundaries.
   * @param consensusFolderService - Used to determine consensus folder boundaries (optional for backwards compat).
   */
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly consensusFolderService?: ConsensusFolderService,
  ) {}

  /**
   * Set the project folder that defines the allowed root boundary.
   * All access outside this folder (after symlink resolution) is denied.
   */
  setProjectFolder(projectFolder: string): void {
    this.projectFolder = path.resolve(projectFolder);
  }

  /**
   * Replace the full permission set.
   *
   * @param permissions - Array of per-participant permission entries.
   */
  setPermissions(permissions: FilePermission[]): void {
    this.permissions = [...permissions];
  }

  /**
   * Return a copy of all current permissions.
   */
  getPermissions(): FilePermission[] {
    return [...this.permissions];
  }

  /**
   * Get the permission entry for a specific participant, or null if none exists.
   */
  getPermissionsForParticipant(participantId: string): FilePermission | null {
    return this.permissions.find((p) => p.participantId === participantId) ?? null;
  }

  /**
   * Validate whether an AI participant may perform the given action on a path.
   *
   * Check order:
   * 1. Project folder must be configured.
   * 2. Path is resolved to absolute.
   * 3. Explicit ".." traversal is blocked.
   * 4. Symbolic link target is resolved and re-checked against project boundary.
   * 5. .arena/workspace/ paths are auto-allowed (read & write; execute still needs permission).
   * 6. Path must be within the project folder.
   * 7. Participant-specific permission flags are checked.
   */
  validateAccess(
    aiId: string,
    targetPath: string,
    action: 'read' | 'write' | 'execute',
  ): AccessCheckResult {
    const base: Pick<AccessCheckResult, 'participantId' | 'targetPath' | 'action'> = {
      participantId: aiId,
      targetPath,
      action,
    };

    // 1. Project folder must be set
    if (!this.projectFolder) {
      return { ...base, allowed: false, reason: 'No project folder configured' };
    }

    // 2. Resolve to absolute path
    const resolved = path.resolve(targetPath);

    // 2b. Consensus folder auto-allow (read & write) — checked before project
    //     boundary because the consensus folder is intentionally outside the project.
    if (this.consensusFolderService?.isConsensusPath(resolved)) {
      if (action === 'read' || action === 'write') {
        return { ...base, allowed: true };
      }
      // Execute in consensus folder is denied (no fall-through to project checks)
      return { ...base, allowed: false, reason: 'Execute permission denied in consensus folder' };
    }

    // 3. Block explicit ".." traversal in the original input
    const normalized = path.normalize(targetPath);
    const relative = path.relative(this.projectFolder, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { ...base, allowed: false, reason: 'Path traversal outside project folder' };
    }

    // Also check raw input for suspicious patterns
    if (normalized.includes('..')) {
      return { ...base, allowed: false, reason: 'Path traversal detected' };
    }

    // 4. Resolve symbolic links to real path and re-check boundary
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      // Path doesn't exist yet -- use the resolved path.
      // This allows write operations to new files within the project.
      realPath = resolved;
    }

    const realRelative = path.relative(this.projectFolder, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      return { ...base, allowed: false, reason: 'Symbolic link escapes project folder' };
    }

    // 5a. .arena/workspace/ auto-allow for read & write
    if (this.workspaceService.isArenaPath(realPath)) {
      if (action === 'read' || action === 'write') {
        return { ...base, allowed: true };
      }
      // Execute in arena still requires explicit permission -- fall through
    }

    // 6. Verify path is inside project folder
    const projectWithSep = this.projectFolder + path.sep;
    if (realPath !== this.projectFolder && !realPath.startsWith(projectWithSep)) {
      return { ...base, allowed: false, reason: 'Path is outside project folder' };
    }

    // 7. Check participant-specific permissions
    const perm = this.getPermissionsForParticipant(aiId);
    if (!perm) {
      return { ...base, allowed: false, reason: 'No permissions configured for participant' };
    }

    if (action === 'read' && !perm.read) {
      if (this.consumeTemporaryGrant(aiId, realPath, action)) return { ...base, allowed: true };
      return { ...base, allowed: false, reason: 'Read permission denied' };
    }
    if (action === 'write' && !perm.write) {
      if (this.consumeTemporaryGrant(aiId, realPath, action)) return { ...base, allowed: true };
      return { ...base, allowed: false, reason: 'Write permission denied' };
    }
    if (action === 'execute' && !perm.execute) {
      if (this.consumeTemporaryGrant(aiId, realPath, action)) return { ...base, allowed: true };
      return { ...base, allowed: false, reason: 'Execute permission denied' };
    }

    return { ...base, allowed: true };
  }

  /** Grant one-time temporary access for a specific participant/path/action. */
  grantTemporaryAccess(
    participantId: string,
    targetPath: string,
    action: 'read' | 'write' | 'execute',
    ttlMs = 5 * 60 * 1000,
  ): void {
    const resolved = path.resolve(targetPath);
    const key = `${participantId}|${action}|${resolved}`;
    this.temporaryGrants.set(key, Date.now() + Math.max(1, ttlMs));
  }

  private consumeTemporaryGrant(
    participantId: string,
    resolvedPath: string,
    action: 'read' | 'write' | 'execute',
  ): boolean {
    const key = `${participantId}|${action}|${resolvedPath}`;
    const expiresAt = this.temporaryGrants.get(key);
    if (!expiresAt) return false;
    this.temporaryGrants.delete(key);
    return expiresAt >= Date.now();
  }
}
