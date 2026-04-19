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
