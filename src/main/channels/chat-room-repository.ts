import type Database from 'better-sqlite3';
import type { ChatRoom, ChatRoomMember } from '../../shared/chat-room-types';
import { ChannelRepository } from './channel-repository';

interface RoomRow { channel_id: string; archived_at: number | null }
interface MemberRow {
  channel_id: string; provider_id: string; sort_order: number;
  display_name: string; persona_source: 'default' | 'custom';
  role: string; personality: string; expertise: string;
  legacy_persona: string; character_sheet: string; effective_persona: string;
}

function toMember(row: MemberRow): ChatRoomMember {
  return {
    channelId: row.channel_id,
    providerId: row.provider_id,
    sortOrder: row.sort_order,
    displayName: row.display_name,
    personaSource: row.persona_source,
    role: row.role,
    personality: row.personality,
    expertise: row.expertise,
    legacyPersona: row.legacy_persona,
    characterSheet: row.character_sheet,
    effectivePersona: row.effective_persona,
  };
}

export class ChatRoomRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly channels: ChannelRepository,
  ) {}

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }

  get(channelId: string): ChatRoom | null {
    const row = this.db.prepare(
      'SELECT channel_id, archived_at FROM chat_rooms WHERE channel_id = ?',
    ).get(channelId) as RoomRow | undefined;
    if (!row) return null;
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Chat room channel missing: ${channelId}`);
    return { ...channel, isChatRoom: true, archivedAt: row.archived_at };
  }

  list(): ChatRoom[] {
    const rows = this.db.prepare(
      'SELECT channel_id FROM chat_rooms ORDER BY created_at DESC, rowid DESC',
    ).all() as Array<{ channel_id: string }>;
    return rows.map((row) => {
      const room = this.get(row.channel_id);
      if (!room) throw new Error(`Chat room missing during list: ${row.channel_id}`);
      return room;
    });
  }

  insert(channelId: string, createdAt: number): void {
    this.db.prepare('INSERT INTO chat_rooms (channel_id, created_at) VALUES (?, ?)')
      .run(channelId, createdAt);
  }

  insertMember(member: ChatRoomMember): void {
    this.db.prepare(`INSERT INTO chat_room_members
      (channel_id, provider_id, sort_order, display_name, persona_source,
       role, personality, expertise, legacy_persona, character_sheet, effective_persona)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      member.channelId, member.providerId, member.sortOrder, member.displayName,
      member.personaSource, member.role, member.personality, member.expertise,
      member.legacyPersona, member.characterSheet, member.effectivePersona,
    );
  }

  listMembers(channelId: string): ChatRoomMember[] {
    const rows = this.db.prepare(`SELECT channel_id, provider_id, sort_order,
      display_name, persona_source, role, personality, expertise,
      legacy_persona, character_sheet, effective_persona
      FROM chat_room_members WHERE channel_id = ? ORDER BY sort_order ASC`)
      .all(channelId) as MemberRow[];
    return rows.map(toMember);
  }

  setArchived(channelId: string, archivedAt: number): void {
    this.db.prepare('UPDATE chat_rooms SET archived_at = ? WHERE channel_id = ?')
      .run(archivedAt, channelId);
    this.db.prepare('UPDATE channels SET read_only = 1 WHERE id = ?').run(channelId);
    this.db.prepare('DELETE FROM cli_chat_sessions WHERE channel_id = ?').run(channelId);
  }

  delete(channelId: string): void {
    this.channels.delete(channelId);
  }
}
