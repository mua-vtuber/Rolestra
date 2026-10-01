import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import type { ChatRoom } from '../../../shared/chat-room-types';
import { CURRENT_SCHEMA_VERSION, LIVE_IPC_CHANNELS } from '../../../shared/ipc-types';
import type { OpinionService } from '../../meetings/opinion-service';
import type { ChatVoteService } from '../../meetings/chat-vote-service';
import { setChatVoteServiceAccessor, setOpinionServiceAccessor } from '../handlers/opinion-handler';

const registered = vi.hoisted(() => new Map<string, (_event: unknown, envelope: unknown) => Promise<unknown>>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, envelope: unknown) => Promise<unknown>) => {
      registered.set(channel, handler);
    },
    removeHandler: (channel: string) => registered.delete(channel),
  },
  app: { getPath: () => 'C:/temp' },
  dialog: {},
}));

import { registerIpcHandlers, unregisterIpcHandlers } from '../router';

const meta = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  timestamp: Date.now(),
};

function channel(id: string, kind: Channel['kind'], projectId: string | null = null, readOnly = false): Channel {
  return { id, kind, projectId, readOnly } as Channel;
}

const channelRows = new Map<string, Channel>([
  ['general', channel('general', 'system_general')],
  ['room', channel('room', 'user')],
  ['archived', channel('archived', 'user', null, true)],
  ['dm', channel('dm', 'dm')],
  ['project', channel('project', 'user', 'old-project')],
]);
const channels = { get: (id: string) => channelRows.get(id) ?? null };
const rooms = { get: (id: string): ChatRoom | null => {
  const base = channelRows.get(id);
  return base && (id === 'room' || id === 'archived')
    ? { ...base, isChatRoom: true, archivedAt: id === 'archived' ? 123 : null }
    : null;
} };
const opinions = { get: (id: string) => {
  const target = id.endsWith('-op') ? id.slice(0, -3) : null;
  return target ? { id, channelId: target, kind: 'user-raised', meetingId: null } : null;
} };
const opinionService = {
  postFromGeneralChannel: vi.fn(({ channelId }: { channelId: string }) => ({ channelId, inserted: [] })),
  listGeneralCards: vi.fn((channelId: string) => ({ channelId, cards: [] })),
  toggleLightVote: vi.fn(({ opinionId, vote }: { opinionId: string; vote: 'agree' | 'oppose' }) =>
    ({ opinionId, effect: 'inserted', userVote: vote, agreeCount: 1, opposeCount: 0 })),
};
const chatVoteService = {
  sendResult: vi.fn((opinionId: string) => ({ id: 'vote-1', opinionId, resultMessageId: 'result-1' })),
  startVote: vi.fn((opinionId: string) => ({ id: 'vote-1', opinionId })),
  getVote: vi.fn((opinionId: string) => ({ id: 'vote-1', opinionId })),
};

function call(channelName: string, data: unknown): Promise<unknown> {
  const handler = registered.get(channelName);
  if (!handler) throw new Error(`IPC handler missing: ${channelName}`);
  return handler(null, { meta, data });
}

const post = (channelId: string, authorProviderId: string | null = null) =>
  ({ channelId, authorProviderId, parts: [{ title: 'Plan', content: 'Vote on this plan' }] });

describe('chat opinion vote IPC boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOpinionServiceAccessor(() => opinionService as unknown as OpinionService);
    setChatVoteServiceAccessor(() => chatVoteService as unknown as ChatVoteService);
    registerIpcHandlers(channels as never, opinions as never, rooms as never);
  });
  afterEach(() => {
    unregisterIpcHandlers();
    registered.clear();
    setOpinionServiceAccessor(null as never);
    setChatVoteServiceAccessor(null as never);
  });

  it('registers only the live whitelist including both chat vote channels', () => {
    expect([...registered.keys()].sort()).toEqual([...LIVE_IPC_CHANNELS].sort());
    expect(registered.has('opinion:startVote')).toBe(true);
    expect(registered.has('opinion:getVote')).toBe(true);
    expect(registered.has('opinion:sendVoteResult')).toBe(true);
    expect(registered.has('meeting:resume')).toBe(false);
  });

  it.each(['general', 'room'])('allows %s card writes and vote start/read', async (channelId) => {
    await expect(call('opinion:postFromGeneral', post(channelId)))
      .resolves.toEqual({ result: { channelId, inserted: [] } });
    await expect(call('opinion:listGeneralCards', { channelId }))
      .resolves.toEqual({ result: { channelId, cards: [] } });
    await expect(call('opinion:toggleLightVote', { opinionId: `${channelId}-op`, vote: 'agree' }))
      .resolves.toMatchObject({ result: { opinionId: `${channelId}-op` } });
    await expect(call('opinion:startVote', { opinionId: `${channelId}-op` }))
      .resolves.toEqual({ result: { id: 'vote-1', opinionId: `${channelId}-op` } });
    await expect(call('opinion:getVote', { opinionId: `${channelId}-op` }))
      .resolves.toEqual({ result: { id: 'vote-1', opinionId: `${channelId}-op` } });
    expect(opinionService.postFromGeneralChannel).toHaveBeenCalledWith(post(channelId));
    expect(chatVoteService.startVote).toHaveBeenCalledWith(`${channelId}-op`);
    await expect(call('opinion:sendVoteResult', { opinionId: `${channelId}-op` }))
      .resolves.toMatchObject({ result: { resultMessageId: 'result-1' } });
  });

  it.each(['dm', 'project', 'missing', 'archived'])('rejects %s card and vote mutations', async (channelId) => {
    await expect(call('opinion:postFromGeneral', post(channelId))).rejects.toThrow();
    await expect(call('opinion:toggleLightVote', { opinionId: `${channelId}-op`, vote: 'agree' })).rejects.toThrow();
    await expect(call('opinion:startVote', { opinionId: `${channelId}-op` })).rejects.toThrow();
    await expect(call('opinion:sendVoteResult', { opinionId: `${channelId}-op` })).rejects.toThrow();
    expect(chatVoteService.sendResult).not.toHaveBeenCalled();
    expect(opinionService.postFromGeneralChannel).not.toHaveBeenCalled();
    expect(opinionService.toggleLightVote).not.toHaveBeenCalled();
    expect(chatVoteService.startVote).not.toHaveBeenCalled();
  });

  it('keeps archived cards and votes readable but rejects other non-chat reads', async () => {
    await expect(call('opinion:listGeneralCards', { channelId: 'archived' }))
      .resolves.toEqual({ result: { channelId: 'archived', cards: [] } });
    await expect(call('opinion:getVote', { opinionId: 'archived-op' }))
      .resolves.toEqual({ result: { id: 'vote-1', opinionId: 'archived-op' } });
    for (const channelId of ['dm', 'project', 'missing']) {
      await expect(call('opinion:listGeneralCards', { channelId })).rejects.toThrow();
      await expect(call('opinion:getVote', { opinionId: `${channelId}-op` })).rejects.toThrow();
    }
  });

  it('rejects a forged AI author and malformed vote IDs before reaching services', async () => {
    await expect(call('opinion:postFromGeneral', post('room', 'agent'))).rejects.toThrow('User opinion author must be null');
    for (const opinionId of ['', 'x'.repeat(129), 123, null]) {
      await expect(call('opinion:startVote', { opinionId })).rejects.toThrow();
      await expect(call('opinion:getVote', { opinionId })).rejects.toThrow();
      await expect(call('opinion:sendVoteResult', { opinionId })).rejects.toThrow();
    }
    expect(opinionService.postFromGeneralChannel).not.toHaveBeenCalled();
    expect(chatVoteService.startVote).not.toHaveBeenCalled();
    expect(chatVoteService.getVote).not.toHaveBeenCalled();
  });
});
