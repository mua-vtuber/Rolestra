import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import { CURRENT_SCHEMA_VERSION, LIVE_IPC_CHANNELS } from '../../../shared/ipc-types';

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
import { setChatPassServiceAccessor } from '../handlers/chat-pass-handler';
import { setChatRoundStateAccessor } from '../handlers/chat-round-handler';
import { ChatPassService } from '../../channels/chat-pass-service';

const channels = {
  get: (id: string) => ({
    id,
    kind: id === 'general' ? 'system_general' : id === 'dm' ? 'dm' : 'user',
  }) as Channel,
};
const opinions = {
  get: (id: string) => ({
    id,
    channelId: id === 'chat-opinion' ? 'general' : 'work',
    meetingId: id === 'meeting-opinion' ? 'meeting-1' : null,
  }),
};
const meta = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  timestamp: Date.now(),
};

describe('live chat IPC registrations', () => {
  afterEach(() => {
    unregisterIpcHandlers();
    registered.clear();
    vi.unstubAllEnvs();
  });

  it('registers chat and provider/settings handlers without work automation', () => {
    registerIpcHandlers(channels, opinions as never);
    expect([...registered.keys()].sort()).toEqual([...LIVE_IPC_CHANNELS].sort());
    for (const channel of [
      'channel:get-global-general', 'dm:create', 'message:append',
      'provider:add', 'config:set-secret', 'opinion:toggleLightVote',
    ]) {
      expect(registered.has(channel)).toBe(true);
    }
    for (const channel of [
      'project:create', 'queue:add', 'execution:approve', 'meeting:resume',
      'channel:start-meeting', 'handoff:approve', 'approval:decide',
      'onboarding:apply-staff-selection', 'design-checkpoint:decide',
    ]) {
      expect(registered.has(channel)).toBe(false);
    }
  });

  it('rejects work-channel message and channel mutations', async () => {
    registerIpcHandlers(channels, opinions as never);
    const append = registered.get('message:append')!;
    await expect(append(null, {
      meta, data: { channelId: 'work', content: 'start work' },
    })).rejects.toThrow('Chat channel not found');
    const remove = registered.get('channel:delete')!;
    await expect(remove(null, {
      meta, data: { id: 'work' },
    })).rejects.toThrow('Chat channel not found');
    const search = registered.get('message:search')!;
    await expect(search(null, {
      meta, data: { query: 'work', scope: { kind: 'project', projectId: 'old-project' } },
    })).rejects.toThrow();
    await expect(registered.get('message:list-by-channel')!(null, {
      meta, data: { channelId: 'work' },
    })).rejects.toThrow('Chat channel not found');
    const vote = registered.get('opinion:toggleLightVote')!;
    await expect(vote(null, {
      meta, data: { opinionId: 'meeting-opinion', vote: 'agree' },
    })).rejects.toThrow('Chat opinion not found');
    await expect(vote(null, {
      meta, data: { opinionId: 'work-opinion', vote: 'agree' },
    })).rejects.toThrow('Chat channel not found');
  });

  it('routes a pass request to the pass service and surfaces its named refusal (spec 2026-10-01 F1)', async () => {
    registerIpcHandlers(channels, opinions as never);
    const append = vi.fn(() => ({ id: 'pass-row' }));
    setChatPassServiceAccessor(() => new ChatPassService({
      channels: {
        get: (id: string) => ({ ...channels.get(id), projectId: null, readOnly: false }),
        isConversationArchiving: () => false,
        listMembers: () => [{ providerId: 'ai-1' }] as never,
      },
      rooms: { get: () => null, listMembers: () => [] },
      messages: { append } as never,
      rounds: { hasActiveRound: () => false },
    }));
    const pass = registered.get('chat:pass-turn')!;
    await expect(pass(null, { meta, data: { channelId: 'dm' } })).rejects.toThrow('chat_pass_rejected:dm_channel');
    await expect(pass(null, { meta, data: { channelId: 'work' } })).rejects.toThrow('Chat channel not found');
    await expect(pass(null, { meta, data: {} })).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
    await expect(pass(null, { meta, data: { channelId: 'general' } })).resolves.toEqual({ message: { id: 'pass-row' } });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'general', authorId: 'user', authorKind: 'user', role: 'user', meta: { chatPass: 'user_pass' },
    }));
  });

  it('marks only chat channels read and searches every chat conversation (spec 2026-10-01 R4/R2)', async () => {
    registerIpcHandlers(channels, opinions as never);
    await expect(registered.get('channel:mark-read')!(null, {
      meta, data: { channelId: 'work', messageId: 'm-1' },
    })).rejects.toThrow('Chat channel not found');
    await expect(registered.get('message:search')!(null, {
      meta, data: { query: 'x', scope: { kind: 'chats', channelId: 'work' } },
    })).rejects.toThrow();
  });

  it('answers which channels have a round in progress (QA M1)', async () => {
    registerIpcHandlers(channels, opinions as never);
    setChatRoundStateAccessor(() => ({ activeRoundChannelIds: () => ['room-1'] }));
    await expect(registered.get('chat:list-active-rounds')!(null, { meta, data: undefined }))
      .resolves.toEqual({ channelIds: ['room-1'] });
    await expect(registered.get('chat:list-active-rounds')!(null, { meta, data: { channelId: 'x' } }))
      .rejects.toThrow();
  });

  it('validates live mutating payloads in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    registerIpcHandlers(channels, opinions as never);
    await expect(registered.get('message:append')!(null, {
      meta, data: { channelId: 'general', content: '' },
    })).rejects.toThrow();
    await expect(registered.get('provider:add')!(null, {
      meta, data: { displayName: 'A', config: { type: 'api', endpoint: 'https://example.com' } },
    })).rejects.toThrow();
    await expect(registered.get('config:set-secret')!(null, {
      meta, data: { key: '../bad', value: 'value' },
    })).rejects.toThrow();
    await expect(registered.get('notification:test')!(null, {
      meta, data: { kind: 'work_done' },
    })).rejects.toThrow();
    await expect(registered.get('notification:update-prefs')!(null, {
      meta, data: { patch: {
        new_message: { enabled: true }, approval_pending: { enabled: false },
      } },
    })).rejects.toThrow();
  });
});
