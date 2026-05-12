/**
 * File / workspace 도메인 타입 — main / renderer / preload 공유.
 *
 * R12-W T10: `FilePermission` / `WorkspaceConfig` / `DEFAULT_FILE_PERMISSION` /
 * `AccessCheckResult` 삭제. 직원 단위 파일 권한 모델이 채널 단위 권한
 * (channels.permissions 5컬럼, ADR §D1) 으로 collapse 되며 옛 타입은 어느
 * production 경로에서도 import 되지 않게 됐다.
 *
 * 남은 타입:
 *   - WorkspaceInfo / WorkspaceSubdirectory / WORKSPACE_SUBDIRS — arena 워크스페이스
 *     서브디렉토리 운영용. workspace-service.ts 가 사용.
 *   - PermissionRequest — stream-types.ts 의 `StreamPermissionPendingEvent`
 *     payload. R7-Task4 시점 emit 경로가 사라졌지만 타입은 stream event map
 *     안에서 살아남아 있어 직접 삭제하려면 stream-types 도 같이 정리해야 함
 *     (R12-W 범위 밖 — 후속 cleanup phase 가 묶음 정리할 영역).
 *   - ConsensusFolderInfo — consensus-folder-service.ts 가 사용.
 */

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
