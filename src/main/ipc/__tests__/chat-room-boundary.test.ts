import { describe, expect, it } from 'vitest';
import { requireChatChannel } from '../chat-channel-boundary';
import type { Channel } from '../../../shared/channel-types';
import type { ChatRoom } from '../../../shared/chat-room-types';
import { catalogDefaultForNullRole } from '../../../shared/permission-set-types';

describe('room chat boundary', () => {
  const channel: Channel = {
    id: 'room', projectId: null, name: 'Room', kind: 'user', readOnly: false,
    createdAt: 1, role: null, purpose: null, handoffMode: 'check', maxRounds: null,
    permissions: catalogDefaultForNullRole(),
  };
  const room: ChatRoom = { ...channel, isChatRoom: true, archivedAt: null };
  const channels = { get: (id: string) => id === 'room' ? channel : null };

  it('admits only registered projectless room channels', () => {
    expect(() => requireChatChannel(channels, 'room')).toThrow('not found');
    expect(requireChatChannel(channels, 'room', { get: () => room })).toEqual(room);
    expect(() => requireChatChannel(channels, 'room', { get: () => null })).toThrow('not found');
  });
});
