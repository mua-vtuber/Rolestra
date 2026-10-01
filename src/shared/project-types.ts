/**
 * Project 도메인 타입 — migrations/002-projects.ts 컬럼과 1:1 camelCase 매핑.
 */

export type ProjectKind = 'new' | 'external' | 'imported';
export type PermissionMode = 'auto' | 'hybrid' | 'approval';
export type AutonomyMode = 'manual' | 'auto_toggle' | 'queue';
export type ProjectStatus = 'active' | 'folder_missing' | 'archived';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: ProjectKind;
  externalLink: string | null;
  permissionMode: PermissionMode;
  autonomyMode: AutonomyMode;
  status: ProjectStatus;
  createdAt: number;
  archivedAt: number | null;
}

export interface ProjectMember {
  projectId: string;
  providerId: string;
  roleAtProject: string | null;
  addedAt: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  kind: ProjectKind;
  permissionMode: PermissionMode;
  autonomyMode: AutonomyMode;
  externalLink?: string;
  schemaVersion: 1;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  kind: ProjectKind;
  externalPath?: string;       // kind=external 필수
  sourcePath?: string;         // kind=imported 필수
  permissionMode: PermissionMode;
  autonomyMode?: AutonomyMode;
  initialMemberProviderIds?: string[];
}

/**
 * `project:delete-preview` 응답 — 영구삭제 모달이 "무엇이 사라지는가" 를
 * 사용자에게 보여줄 때 쓰는 집계.
 *
 * 세 숫자는 모두 *영구삭제로 실제 사라지는* 행만 센다. 회의록 markdown 은
 * 합의 폴더 (`<ArenaRoot>/consensus/meetings/<meetingId>/minutes.md`) 에
 * 남으므로 이 집계에 포함되지 않는다 — 사용자의 문서라서 지우지 않는다.
 */
export interface ProjectDeletePreview {
  projectId: string;
  slug: string;
  name: string;
  kind: ProjectKind;
  channels: number;
  meetings: number;
  messages: number;
  /**
   * 함께 사라질 회의록 폴더 수 (ruling R42). 회의 수와 같지만, 화면이
   * "회의록도 지워진다" 를 숫자로 말하려면 실제 삭제 대상을 센 값이어야
   * 한다.
   */
  minutesFolders: number;
  /** 프로젝트 폴더 절대 경로. `external` 은 wrapper 폴더 (링크 대상 아님). */
  rootPath: string;
  /**
   * `external` 프로젝트가 가리키는 외부 폴더 실제 경로. 영구삭제해도
   * 이 폴더는 건드리지 않는다. 다른 kind 는 null.
   */
  externalTarget: string | null;
  /** 진행 중 회의가 있으면 true — 영구삭제가 거부된다. */
  hasActiveMeeting: boolean;
}
