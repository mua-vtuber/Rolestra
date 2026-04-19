/**
 * Member Profile 도메인 타입 — migrations/001-core.ts member_profiles 컬럼과 1:1 camelCase 매핑,
 * 런타임 상태 판정 결과를 포함하는 MemberView 파생 타입 제공.
 */

export type WorkStatus = 'online' | 'connecting' | 'offline-connection' | 'offline-manual';
export type StatusOverride = 'offline-manual' | null;
export type AvatarKind = 'default' | 'custom';

export interface MemberProfile {
  providerId: string;
  role: string;
  personality: string;
  expertise: string;
  avatarKind: AvatarKind;
  avatarData: string | null;     // default: palette key, custom: relative path or base64
  statusOverride: StatusOverride;
  updatedAt: number;
}

export interface MemberView extends MemberProfile {
  displayName: string;       // providers.display_name
  persona: string;           // providers.persona (legacy fallback)
  workStatus: WorkStatus;    // runtime 판정
}
