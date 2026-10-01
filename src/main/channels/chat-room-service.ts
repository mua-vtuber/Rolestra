import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tryGetLogger } from '../log/logger-accessor';
import type { ChatRoom, ChatRoomMember, CreateChatRoomInput } from '../../shared/chat-room-types';
import type { Channel } from '../../shared/channel-types';
import type { MemberProfile } from '../../shared/member-profile-types';
import { catalogDefaultForNullRole } from '../../shared/permission-set-types';
import { buildChatPersona } from '../members/persona-builder';
import { ChannelRepository } from './channel-repository';
import { ChatRoomRepository } from './chat-room-repository';

export interface ChatRoomProviderLookup {
  get(id: string): { displayName: string } | undefined;
}

export interface ChatRoomProfileLookup {
  getProfile(providerId: string): MemberProfile;
}

export class ChatRoomService extends EventEmitter {
  constructor(
    private readonly repo: ChatRoomRepository,
    private readonly channels: ChannelRepository,
    private readonly providers: ChatRoomProviderLookup,
    private readonly profiles: ChatRoomProfileLookup,
  ) { super(); }

  create(input: CreateChatRoomInput): ChatRoom {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new Error('Invalid chat room name');
    if (input.participants.length < 1 || input.participants.length > 64) {
      throw new Error('Chat room requires 1 to 64 participants');
    }
    const ids = input.participants.map((part) => part.providerId);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate chat room participant');

    const id = randomUUID();
    const createdAt = Date.now();
    const members: ChatRoomMember[] = input.participants.map((part, sortOrder) => {
      const provider = this.providers.get(part.providerId);
      if (!provider) throw new Error(`Chat room provider not found: ${part.providerId}`);
      const profile = this.profiles.getProfile(part.providerId);
      if (part.personaSource !== 'default' && part.personaSource !== 'custom') {
        throw new Error('Invalid chat room persona source');
      }
      const custom = part.customPersona?.trim();
      if (part.personaSource === 'custom' && !custom) {
        throw new Error('Custom chat room persona is required');
      }
      const characterSheet = part.personaSource === 'custom' ? (custom ?? '') : profile.characterSheet;
      return {
        channelId: id,
        providerId: part.providerId,
        sortOrder,
        displayName: provider.displayName,
        personaSource: part.personaSource,
        // Pre-F3 snapshot columns (migration 030) — kept for the DB row
        // shape and migration 034's own backfill, but no longer sourced
        // from the live profile: `characterSheet` is the sole snapshot
        // application code reads or writes going forward (spec §F3-3).
        // `legacyPersona` is always '' for a NEW room — QA defect 1
        // removed provider:add's `persona` input, so there is no live
        // legacy value left to snapshot; a pre-F3 provider's real legacy
        // text, if any, already lives in `providers.persona` (kept, never
        // read by this path) and was merged into `characterSheet` by
        // migration 034 for any member profile that existed then.
        role: '', personality: '', expertise: '', legacyPersona: '',
        characterSheet,
        effectivePersona: buildChatPersona({
          displayName: provider.displayName,
          characterSheet,
        }),
      };
    });
    const channel: Channel = {
      id, projectId: null, name, kind: 'user', readOnly: false, createdAt,
      role: null, purpose: null, handoffMode: 'check', maxRounds: null,
      permissions: catalogDefaultForNullRole(),
    };
    this.repo.transaction(() => {
      this.channels.insert(channel);
      this.repo.insert(id, createdAt);
      for (const member of members) this.repo.insertMember(member);
    });
    return { ...channel, isChatRoom: true, archivedAt: null };
  }

  get(channelId: string): ChatRoom | null { return this.repo.get(channelId); }
  list(): ChatRoom[] { return this.repo.list(); }

  listMembers(channelId: string): ChatRoomMember[] {
    if (!this.repo.get(channelId)) throw new Error(`Chat room not found: ${channelId}`);
    return this.repo.listMembers(channelId);
  }

  getEffectivePersona(channelId: string, providerId: string): string {
    const member = this.listMembers(channelId).find((item) => item.providerId === providerId);
    if (!member) throw new Error(`Chat room participant not found: ${providerId}`);
    return member.effectivePersona;
  }

  assertActive(channelId: string): void {
    const room = this.get(channelId);
    if (!room) throw new Error(`Chat room not found: ${channelId}`);
    if (room.archivedAt !== null) throw new Error(`Chat room archived: ${channelId}`);
  }

  /** No-op for legacy channels; invoked synchronously just before every INSERT. */
  assertAppendAllowed(channelId: string): void {
    const room = this.get(channelId);
    if (room && room.archivedAt !== null) {
      throw new Error(`Chat room archived: ${channelId}`);
    }
  }

  private notifyClosed(channelId: string): void {
    try {
      this.emit('closed', { channelId });
    } catch (error) {
      // The database transition already committed; a listener cannot undo
      // it. console.warn does not persist in the packaged app — route
      // through the project logger so the failure stays observable.
      tryGetLogger()?.error({
        component: 'chat-room', action: 'close-listener', result: 'failure',
        metadata: { channelId, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  archive(channelId: string): ChatRoom {
    this.assertActive(channelId);
    this.repo.transaction(() => this.repo.setArchived(channelId, Date.now()));
    this.notifyClosed(channelId);
    const archived = this.get(channelId);
    if (!archived) throw new Error(`Chat room not found after archive: ${channelId}`);
    return archived;
  }

  delete(channelId: string): void {
    const room = this.get(channelId);
    if (!room) throw new Error(`Chat room not found: ${channelId}`);
    if (room.archivedAt === null) throw new Error('Archive chat room before deletion');
    this.repo.transaction(() => this.repo.delete(channelId));
    this.notifyClosed(channelId);
  }
}
