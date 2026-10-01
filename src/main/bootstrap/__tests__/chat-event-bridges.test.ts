import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import type { Message } from '../../../shared/message-types';
import type { ChatServices } from '../chat-services';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  streamCompletion: vi.fn(async function* () { yield '{"public":"hello back","whispers":[]}'; }),
}));
vi.mock('../../database/connection', () => ({ getDatabase: () => ({}) }));
vi.mock('../../channels/chat-whisper-round-repository', () => ({
  ChatWhisperRoundRepository: class {
    claim() { return true; }
    finish() { /* fixture */ }
    interrupt() { /* fixture */ }
    interruptChannel() { /* fixture */ }
    interruptRunning() { /* fixture */ }
  },
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{
    webContents: { isDestroyed: () => false, send: mocks.send },
  }] },
}));
vi.mock('../../providers/registry', () => ({
  providerRegistry: { get: () => ({
    id: 'bot', displayName: 'Bot', persona: '', type: 'api',
    resetConversationContext: () => undefined,
    streamCompletion: mocks.streamCompletion,
  }) },
}));

import { createChatStreamBridge, wireChatMessageFlows } from '../chat-event-bridges';
import { DmChannelService } from '../../channels/dm-channel-service';

const general = { id: 'general', kind: 'system_general', projectId: null } as Channel;
const work = { id: 'work', kind: 'user', projectId: 'old-project' } as Channel;
const userMessage = (channelId: string): Message => ({
  id: 'message-1', channelId, meetingId: null, authorId: 'user',
  authorKind: 'user', role: 'user', content: 'hello', meta: null, createdAt: 1,
});

describe('active chat event wiring', () => {
  it('streams a general reply while ignoring archived project messages', async () => {
    const messages = new EventEmitter();
    const append = vi.fn((input: Omit<Message, 'id' | 'createdAt' | 'meta'>) => {
      const message = { ...input, id: 'reply', createdAt: 2, meta: null } as Message;
      messages.emit('message', message);
      return message;
    });
    const services = {
      channelService: {
        get: (id: string) => id === 'general' ? general : work,
        listMembers: () => [{ providerId: 'bot' }],
        setConversationArchiveLifecycle: vi.fn(),
      },
      dmChannelService: new DmChannelService({ get: () => null, delete: vi.fn() }),
      messageService: Object.assign(messages, {
        append, listByChannel: () => [userMessage('general')],
      }),
      memberProfileService: Object.assign(new EventEmitter(), {
        getProfile: () => ({ characterSheet: 'Role: friend\nPersonality: warm\nExpertise: chat' }),
      }),
      opinionService: { postFromGeneralChannel: vi.fn() },
      chatVoteService: { interruptChannel: vi.fn() },
      arenaRoot: { consensusPath: () => 'C:/arena/consensus' },
    } as unknown as ChatServices;
    const responder = wireChatMessageFlows(services);
    createChatStreamBridge(services, responder);
    const archiveLifecycle = vi.mocked(services.channelService.setConversationArchiveLifecycle).mock.calls[0]?.[0];
    expect(archiveLifecycle).toBeDefined();
    await archiveLifecycle?.pause('general');
    expect(services.chatVoteService.interruptChannel).toHaveBeenCalledWith('general');
    archiveLifecycle?.resume('general');

    services.messageService.emit('message', userMessage('general'));
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      channelId: 'general', role: 'assistant', content: 'hello back',
    });
    expect(mocks.send).toHaveBeenCalledWith('stream:channel-message', expect.any(Object));
    // The writing indicator reaches the window too (spec 2026-10-01 F5).
    expect(mocks.send.mock.calls.filter(([type]) => type === 'stream:chat-activity').map(([, payload]) => payload))
      .toEqual([
        { channelId: 'general', providerId: 'bot', phase: 'writing', kind: 'turn' },
        { channelId: 'general', providerId: 'bot', phase: 'idle', kind: 'turn' },
      ]);
    // So does the round signal around it (QA M1).
    expect(mocks.send.mock.calls.filter(([type]) => type === 'stream:chat-round').map(([, payload]) => payload))
      .toEqual([{ channelId: 'general', active: true }, { channelId: 'general', active: false }]);

    services.messageService.emit('message', userMessage('work'));
    await Promise.resolve();
    expect(append).toHaveBeenCalledOnce();
  });

  it('isolates a synchronous throw in the chat-flow listener from the stream-bridge listener (D2)', async () => {
    // D2 (2026-09-28): MessageService is a plain node:events EventEmitter,
    // so a synchronous throw from the FIRST 'message' listener
    // (wireChatMessageFlows, registered before createChatStreamBridge in
    // src/main/index.ts) would stop the SECOND listener (the stream
    // bridge) from running at all — the message would silently never
    // reach the renderer. This guards the try/catch added around the
    // chat-flow listener body: channelService.get() throwing must not
    // prevent stream:channel-message from still firing.
    const messages = new EventEmitter();
    const append = vi.fn((input: Omit<Message, 'id' | 'createdAt' | 'meta'>) => {
      const message = { ...input, id: 'reply', createdAt: 2, meta: null } as Message;
      messages.emit('message', message);
      return message;
    });
    const services = {
      channelService: {
        get: vi.fn(() => {
          throw new Error('boom: channel lookup exploded');
        }),
        listMembers: () => [{ providerId: 'bot' }],
        setConversationArchiveLifecycle: vi.fn(),
      },
      dmChannelService: new DmChannelService({ get: () => null, delete: vi.fn() }),
      messageService: Object.assign(messages, {
        append, listByChannel: () => [userMessage('general')],
      }),
      memberProfileService: Object.assign(new EventEmitter(), {
        getProfile: () => ({ characterSheet: 'Role: friend\nPersonality: warm\nExpertise: chat' }),
      }),
      opinionService: { postFromGeneralChannel: vi.fn() },
      chatVoteService: { interruptChannel: vi.fn() },
      arenaRoot: { consensusPath: () => 'C:/arena/consensus' },
    } as unknown as ChatServices;
    const responder = wireChatMessageFlows(services);
    createChatStreamBridge(services, responder);

    // Must not throw out of emit() — the chat-flow listener catches its
    // own failure internally.
    expect(() => {
      services.messageService.emit('message', userMessage('general'));
    }).not.toThrow();

    // The stream-bridge listener (registered AFTER the chat-flow
    // listener) must still have run and forwarded the message.
    expect(mocks.send).toHaveBeenCalledWith(
      'stream:channel-message',
      expect.objectContaining({ message: expect.objectContaining({ channelId: 'general' }) }),
    );
    // The chat-flow listener bailed before calling the auto-responder.
    expect(append).not.toHaveBeenCalled();
  });

  it('closes an in-flight DM reply when the DM is deleted', async () => {
    const dm = { id: 'dm', kind: 'dm', projectId: null } as Channel;
    let stored = true;
    let signal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.streamCompletion.mockImplementationOnce(async function* (...args: unknown[]) {
      signal = args[3] as AbortSignal;
      await gate;
      yield 'late DM reply';
    });
    const append = vi.fn();
    const channelService = {
      get: (id: string) => id === 'dm' && stored ? dm : null,
      listMembers: () => [{ providerId: 'bot' }],
      setConversationArchiveLifecycle: vi.fn(),
      delete: vi.fn(() => { stored = false; }),
    };
    const services = {
      channelService,
      dmChannelService: new DmChannelService(channelService as never),
      messageService: Object.assign(new EventEmitter(), {
        append, listByChannel: () => [userMessage('dm')],
      }),
      memberProfileService: Object.assign(new EventEmitter(), {
        getProfile: () => ({ characterSheet: 'Role: friend\nPersonality: warm\nExpertise: chat' }),
      }),
      opinionService: { postFromGeneralChannel: vi.fn() },
      chatVoteService: { interruptChannel: vi.fn() },
      arenaRoot: { consensusPath: () => 'C:/arena/consensus' },
    } as unknown as ChatServices;
    wireChatMessageFlows(services);

    services.messageService.emit('message', userMessage('dm'));
    await vi.waitFor(() => expect(signal).toBeDefined());
    services.dmChannelService.delete('dm');
    expect(channelService.delete).toHaveBeenCalledWith('dm');
    expect(signal?.aborted).toBe(true);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(append).not.toHaveBeenCalled();
  });
});
