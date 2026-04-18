/**
 * File permission and workspace type definitions shared between main and renderer.
 *
 * Controls per-AI file access within a project folder.
 * The .arena/workspace/ directory is automatically granted full access to all participants.
 */

/** Per-AI permission set for a specific folder. */
export interface FilePermission {
  /** The AI participant this permission applies to. */
  participantId: string;
  /** The folder these permissions govern. */
  folderPath: string;
  /** Whether the AI can read files. */
  read: boolean;
  /** Whether the AI can write/modify files. */
  write: boolean;
  /** Whether the AI can execute commands in this folder. */
  execute: boolean;
}

/** Workspace configuration for a work-mode conversation. */
export interface WorkspaceConfig {
  /** User-selected project folder path. */
  projectFolder: string;
  /** Auto-generated arena workspace path (.arena/workspace/ inside project). */
  arenaFolder: string;
  /** Per-AI permissions for the project folder. */
  permissions: FilePermission[];
}

/** Serializable workspace info for IPC transport. */
export interface WorkspaceInfo {
  projectFolder: string;
  arenaFolder: string;
  exists: boolean;
  subdirectories: WorkspaceSubdirectory[];
}

/** Standard subdirectories inside .arena/workspace/. */
export type WorkspaceSubdirectory = 'drafts' | 'proposals' | 'approved';

/** All standard workspace subdirectories. */
export const WORKSPACE_SUBDIRS: WorkspaceSubdirectory[] = [
  'drafts',
  'proposals',
  'approved',
];

/** Access check result for UI display. */
export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  participantId: string;
  targetPath: string;
  action: 'read' | 'write' | 'execute';
}

/** A user-approvable runtime permission request raised during execution. */
export interface PermissionRequest {
  requestId: string;
  conversationId: string;
  participantId: string;
  action: 'read' | 'write' | 'execute';
  targetPath: string;
  reason?: string;
  timestamp: number;
}

/** Consensus folder status information for IPC transport. */
export interface ConsensusFolderInfo {
  /** Resolved absolute path to the consensus folder. */
  folderPath: string;
  /** Whether the folder exists on disk. */
  exists: boolean;
  /** Whether this is the platform default path (vs. user-customized). */
  isDefault: boolean;
}

/** Default permissions for a new participant (read-only). */
export const DEFAULT_FILE_PERMISSION: Omit<FilePermission, 'participantId' | 'folderPath'> = {
  read: true,
  write: false,
  execute: false,
};
