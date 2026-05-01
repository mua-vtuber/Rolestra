/**
 * Channel 도메인 타입 — migrations/003-channels.ts + 018-channels-role-purpose-handoff.ts 컬럼과 1:1 camelCase 매핑.
 */

import type { ChannelRole, ChannelPurpose, HandoffMode } from './channel-role-types';

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
}

export interface ChannelMember {
  channelId: string;
  projectId: string | null;
  providerId: string;
  /** R12-C — 멤버 단위 발화 순서 (drag-and-drop). NULL = 미설정. */
  dragOrder: number | null;
}
