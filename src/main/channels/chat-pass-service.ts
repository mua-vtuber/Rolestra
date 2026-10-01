/**
 * Pass button (spec 2026-10-01 F1): the user moves a room or the general
 * channel on without writing anything.
 *
 * The service stores one public, user-authored "pass" row that carries only
 * `CHAT_PASS_CODE` (content and `meta.chatPass`). Like any user message, the
 * row reaches the responder through the message listener
 * (`bootstrap/chat-event-bridges.ts`) and becomes the round's source: it is
 * a user + public row, so `ChatWhisperRoundRepository.claim` and the 035
 * whisper-source trigger accept it unchanged. Models read it as
 * `CHAT_PASS_MODEL_LINE`; the round hint asks for new content or silence.
 *
 * Refusals are never silent: each throws {@link ChatPassRejectedError} with a
 * named code the renderer translates, and nothing is stored.
 */
import type { Message } from '../../shared/message-types';
import { CHAT_PASS_CODE } from '../../shared/message-types';
import {
  chatPassRejectedMessage, type ChatPassRejectionCode,
} from '../../shared/chat-pass-types';
import type { ChannelService } from './channel-service';
import type { ChatRoomService } from './chat-room-service';
import type { MessageService } from './message-service';
import { USER_AUTHOR_LITERAL } from './message-service';

export class ChatPassRejectedError extends Error {
  constructor(readonly code: ChatPassRejectionCode, readonly channelId: string) {
    super(`${chatPassRejectedMessage(code)} (channel ${channelId})`);
    this.name = 'ChatPassRejectedError';
  }
}

export interface ChatPassServiceDeps {
  channels: Pick<ChannelService, 'get' | 'isConversationArchiving' | 'listMembers'>;
  rooms: Pick<ChatRoomService, 'get' | 'listMembers'>;
  messages: Pick<MessageService, 'append'>;
  /** The responder: whether this channel has a round running or waiting. */
  rounds: { hasActiveRound(channelId: string): boolean };
}

export class ChatPassService {
  constructor(private readonly deps: ChatPassServiceDeps) {}

  pass(channelId: string): Message {
    const channel = this.deps.channels.get(channelId);
    if (!channel) throw new Error(`Chat channel not found: ${channelId}`);
    if (channel.kind === 'dm') throw new ChatPassRejectedError('dm_channel', channelId);
    const room = this.deps.rooms.get(channelId);
    if (channel.projectId !== null ||
      !(channel.kind === 'system_general' || (channel.kind === 'user' && room))) {
      throw new Error(`Chat channel not found: ${channelId}`);
    }
    if (channel.readOnly || room?.archivedAt != null ||
      this.deps.channels.isConversationArchiving(channelId)) {
      throw new ChatPassRejectedError('room_archived', channelId);
    }
    if (this.deps.rounds.hasActiveRound(channelId)) throw new ChatPassRejectedError('round_running', channelId);
    // A round needs someone to speak; the responder would skip an empty one.
    const participants = room ? this.deps.rooms.listMembers(channelId) : this.deps.channels.listMembers(channelId);
    if (participants.length === 0) throw new ChatPassRejectedError('no_participants', channelId);
    return this.deps.messages.append({
      channelId, meetingId: null, authorId: USER_AUTHOR_LITERAL, authorKind: 'user', role: 'user',
      content: CHAT_PASS_CODE, meta: { chatPass: CHAT_PASS_CODE },
    });
  }
}
