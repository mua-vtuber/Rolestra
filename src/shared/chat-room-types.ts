import type { Channel } from './channel-types';

export interface ChatRoom extends Channel {
  isChatRoom: true;
  archivedAt: number | null;
}

export type ChatRoomPersonaSource = 'default' | 'custom';

export interface CreateChatRoomParticipant {
  providerId: string;
  personaSource: ChatRoomPersonaSource;
  customPersona?: string;
}

export interface CreateChatRoomInput {
  name: string;
  participants: CreateChatRoomParticipant[];
}

/**
 * Frozen at room creation; profile and provider edits do not rewrite these
 * fields.
 *
 * `role` / `personality` / `expertise` / `legacyPersona` are the pre-F3
 * snapshot columns (migration 030) — kept for the DB row shape and for
 * migration 034's backfill, but no longer read by application code that
 * builds or displays a room's persona (`characterSheet` replaced them as
 * the single free-text snapshot — spec §F3-3, migration 034).
 */
export interface ChatRoomMember {
  channelId: string;
  providerId: string;
  sortOrder: number;
  displayName: string;
  personaSource: ChatRoomPersonaSource;
  role: string;
  personality: string;
  expertise: string;
  legacyPersona: string;
  /** Free-text character sheet snapshot (migration 034). Frozen at room creation. */
  characterSheet: string;
  effectivePersona: string;
}
