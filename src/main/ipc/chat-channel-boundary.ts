import type { ChannelService } from '../channels/channel-service';
import type { Channel } from '../../shared/channel-types';
import type { ChatRoom } from '../../shared/chat-room-types';

type ChannelLookup = Pick<ChannelService, 'get'>;
type RoomLookup = { get(channelId: string): ChatRoom | null };

export function requireChatChannel(
  channels: ChannelLookup,
  channelId: string,
  rooms?: RoomLookup,
): Channel {
  const channel = channels.get(channelId);
  if (!channel || (channel.kind !== 'system_general' && channel.kind !== 'dm' &&
    !(channel.kind === 'user' && channel.projectId === null && rooms?.get(channelId)))) {
    throw new Error(`Chat channel not found: ${channelId}`);
  }
  return rooms?.get(channelId) ?? channel;
}

export function requireGlobalGeneral(
  channels: ChannelLookup,
  channelId: string,
): void {
  if (requireChatChannel(channels, channelId).kind !== 'system_general') {
    throw new Error(`Global general channel not found: ${channelId}`);
  }
}

export function requireChatOpinionChannel(
  channels: ChannelLookup,
  channelId: string,
  rooms?: RoomLookup,
  write = false,
): void {
  const channel = channels.get(channelId);
  const room = rooms?.get(channelId);
  if (!channel || channel.projectId !== null ||
    !(channel.kind === 'system_general' || (channel.kind === 'user' && room))) {
    throw new Error(`Chat channel not found: ${channelId}`);
  }
  if (write && (channel.readOnly || room?.archivedAt != null)) {
    throw new Error(`Chat room archived: ${channelId}`);
  }
}

/** channel:delete 가 지울 수 있는 채널: DM 또는 전역 일반 채널. 채팅방은 room:delete 를 쓴다. */
export function requireDeletableChatChannel(channels: ChannelLookup, channelId: string): 'dm' | 'general' {
  const channel = requireChatChannel(channels, channelId);
  if (channel.kind === 'dm') return 'dm';
  if (channel.kind === 'system_general' && channel.projectId === null) return 'general';
  throw new Error(`Chat channel not deletable: ${channelId}`);
}
