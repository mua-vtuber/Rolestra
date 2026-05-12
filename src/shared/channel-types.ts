/**
 * Channel 도메인 타입 — migrations/003-channels.ts + 018-channels-role-purpose-handoff.ts
 * + 019-opinion-tables.ts (channels.max_rounds ALTER) + 023-channel-permissions.ts
 * (R12-W 권한 5컬럼) 와 1:1 camelCase 매핑.
 */

import type { ChannelRole, ChannelPurpose, HandoffMode } from './channel-role-types';
import type { PermissionSet } from './permission-set-types';

export type ChannelKind = 'system_general' | 'system_approval' | 'system_minutes' | 'user' | 'dm';

export interface Channel {
  id: string;
  projectId: string | null; // DM은 null, system_general 도 R12-C 후 null (전역)
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
  createdAt: number;
  /** R12-C — 부서 매핑. system 채널 / DM / legacy user 는 null. */
  role: ChannelRole;
  /** R12-C — 사용자 작성 자유 텍스트. */
  purpose: ChannelPurpose;
  /** R12-C — 부서 인계 직전 confirm 모드. 디폴트 'check'. */
  handoffMode: HandoffMode;
  /**
   * R12-C2 (migration 019) — 회의 자유 토론 라운드 cap.
   *
   * - `null`     무제한 (사용자가 채널 설정에서 명시적으로 무제한 선택)
   * - 정수 `N`   N 라운드 도달 시 사용자 호출 (Notification + compose_minutes 점프)
   *
   * 사용자 결정 (2026-05-04, ④ 결정): 채널 *생성* 시 디폴트 = 5 (P3 채널 설정
   * 모달이 디폴트 5 입력). migration 019 가 NULL 허용 + DEFAULT 없음으로 land
   * 됐기 때문에 *기존* 채널들은 NULL — orchestrator 가 `channel.maxRounds ?? 5`
   * 로 코드 fallback (`MEETING_DEFAULT_MAX_ROUNDS`).
   */
  maxRounds: number | null;
  /**
   * R12-W (migration 023) — 채널 권한 5 axis. 회의 turn 페르소나 합성 + CLI argv
   * 2단계 filter 의 권한 source. 부서 채널은 SKILL_CATALOG 정본을 default 로
   * 받으며 (T3 backfill), system 채널 / DM 은 D2 안전 측 (`fileRead=true, 나머지
   * false`) 으로 시작. 사용자가 채널 설정 모달에서 row 단위로 override 가능.
   */
  permissions: PermissionSet;
}

export interface ChannelMember {
  channelId: string;
  projectId: string | null;
  providerId: string;
  /** R12-C — 멤버 단위 발화 순서 (drag-and-drop). NULL = 미설정. */
  dragOrder: number | null;
}
