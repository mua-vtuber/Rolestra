import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberProfile } from '../../../shared/member-profile-types';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { ChannelRepository } from '../channel-repository';
import { ChatRoomRepository } from '../chat-room-repository';
import { ChatRoomService } from '../chat-room-service';
import { MessageRepository } from '../message-repository';
import { MessageService } from '../message-service';
import { setChatRoomServiceAccessor } from '../../ipc/handlers/room-handler';
import { setChannelMemberServiceAccessor, handleChannelListMembers } from '../../ipc/handlers/channel-handler';
import { v3ChannelSchemas } from '../../../shared/ipc-schemas';

describe('ChatRoomService', () => {
  let db: Database.Database;
  let rooms: ChatRoomService;
  let messages: MessageService;
  let profile: MemberProfile;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    profile = {
      providerId: 'agent', characterSheet: 'Role: Writer\nPersonality: Calm\nExpertise: Stories',
      avatarKind: 'default', avatarData: null, statusOverride: null, updatedAt: 1,
    };
    const channelRepo = new ChannelRepository(db);
    rooms = new ChatRoomService(
      new ChatRoomRepository(db, channelRepo), channelRepo,
      { get: (id) => id === 'agent' ? { displayName: 'Agent' } : undefined },
      { getProfile: () => profile },
    );
    messages = new MessageService(new MessageRepository(db), rooms);
  });

  afterEach(() => db.close());

  it('creates multiple projectless rooms with independent frozen personas', () => {
    const first = rooms.create({ name: 'First', participants: [
      { providerId: 'agent', personaSource: 'default' },
    ] });
    const second = rooms.create({ name: 'Second', participants: [
      { providerId: 'agent', personaSource: 'custom', customPersona: 'A private role' },
    ] });
    profile.characterSheet = 'Changed globally';

    expect(first.kind).toBe('user');
    expect(first.projectId).toBeNull();
    expect(rooms.list()).toHaveLength(2);
    expect(rooms.getEffectivePersona(first.id, 'agent')).toContain('Role: Writer');
    expect(rooms.getEffectivePersona(first.id, 'agent')).not.toContain('Changed globally');
    const custom = rooms.getEffectivePersona(second.id, 'agent');
    expect(custom).toContain('[Chat Conversation Rules]');
    expect(custom).toContain('Name: Agent');
    expect(custom).toContain('A private role');
    expect(custom).not.toContain('Role: Writer');
    expect(rooms.listMembers(first.id)[0]?.displayName).toBe('Agent');
    // F3 (QA defect 1): provider:add no longer collects a persona input,
    // so a NEW room's legacy_persona snapshot column is always empty —
    // there is no live legacy value left to snapshot. The DB column
    // itself (migration 030) is kept; this just proves the write side no
    // longer sources it from BaseProvider.persona.
    expect(rooms.listMembers(first.id)[0]?.legacyPersona).toBe('');
    expect(rooms.listMembers(second.id)[0]?.legacyPersona).toBe('');
  });

  it('preserves archived history, blocks user and late member appends, then deletes only archived rooms', () => {
    const room = rooms.create({ name: 'To archive', participants: [
      { providerId: 'agent', personaSource: 'default' },
    ] });
    messages.append({
      channelId: room.id, authorId: 'user', authorKind: 'user', role: 'user', content: 'saved',
    });
    const closed = vi.fn();
    rooms.on('closed', closed);
    expect(() => rooms.delete(room.id)).toThrow('Archive');

    const archived = rooms.archive(room.id);
    expect(archived.readOnly).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
    expect(messages.listByChannel(room.id)).toHaveLength(1);
    expect(() => messages.append({
      channelId: room.id, authorId: 'user', authorKind: 'user', role: 'user', content: 'too late',
    })).toThrow('archived');
    expect(() => messages.append({
      channelId: room.id, authorId: 'agent', authorKind: 'member', role: 'assistant', content: 'late AI',
    })).toThrow('archived');
    expect(closed).toHaveBeenCalledWith({ channelId: room.id });

    rooms.delete(room.id);
    expect(rooms.get(room.id)).toBeNull();
    expect((db.prepare('SELECT count(*) AS n FROM messages WHERE channel_id = ?')
      .get(room.id) as { n: number }).n).toBe(0);
  });

  it('returns frozen room member views even when the provider was removed', () => {
    const room = rooms.create({ name: 'Snapshot', participants: [
      { providerId: 'agent', personaSource: 'default' },
    ] });
    setChatRoomServiceAccessor(() => rooms);
    setChannelMemberServiceAccessor(() => ({
      getView: () => { throw new Error('provider removed'); },
    }) as never);

    expect(handleChannelListMembers({ channelId: room.id }).members).toEqual([
      expect.objectContaining({
        providerId: 'agent', displayName: 'Agent',
        characterSheet: 'Role: Writer\nPersonality: Calm\nExpertise: Stories',
        workStatus: 'offline-connection', isRoomSnapshot: true,
        roomPersona: expect.stringContaining('Role: Writer'),
      }),
    ]);
  });

  it('rejects duplicate participants and empty custom persona at the IPC boundary', () => {
    const base = { name: 'Test', participants: [
      { providerId: 'agent', personaSource: 'default' as const },
    ] };
    expect(() => v3ChannelSchemas['room:create'].parse(base)).not.toThrow();
    expect(() => v3ChannelSchemas['room:create'].parse({
      ...base, participants: [base.participants[0], base.participants[0]],
    })).toThrow();
    expect(() => rooms.create({ name: 'Invalid', participants: [
      { providerId: 'agent', personaSource: 'custom', customPersona: ' ' },
    ] })).toThrow('Custom chat room persona');
  });
});
