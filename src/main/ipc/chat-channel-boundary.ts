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

export function requireDm(channels: ChannelLookup, channelId: string): void {
  if (requireChatChannel(channels, channelId).kind !== 'dm') {
    throw new Error(`DM channel not found: ${channelId}`);
  }
}
