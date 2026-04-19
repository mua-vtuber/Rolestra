/**
 * Channel 도메인 타입 — migrations/003-channels.ts 컬럼과 1:1 camelCase 매핑.
 */

export type ChannelKind = 'system_general' | 'system_approval' | 'system_minutes' | 'user' | 'dm';

export interface Channel {
  id: string;
  projectId: string | null; // DM은 null
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
  createdAt: number;
}

export interface ChannelMember {
  channelId: string;
  projectId: string | null;
  providerId: string;
}
