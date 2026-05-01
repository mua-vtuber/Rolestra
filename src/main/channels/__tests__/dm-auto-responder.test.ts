import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelMember } from '../../../shared/channel-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import type { BaseProvider } from '../../providers/provider-interface';
import { DmAutoResponder, type DmAutoResponderDeps } from '../dm-auto-responder';

const dmChannel: Channel = {
  id: 'dm-1',
  projectId: null,
  name: 'dm:p-claude',
  kind: 'dm',
  readOnly: false,
  createdAt: 0,
  role: null,
  purpose: null,
  handoffMode: 'check',
};

const dmMember: ChannelMember = {
  channelId: 'dm-1',
  projectId: null,
  providerId: 'p-claude',
  dragOrder: null,
};

function mkChannelMessage(content: string): ChannelMessage {
  return {
    id: 'm-1',
    channelId: 'dm-1',
    meetingId: null,
    authorId: 'user',
    authorKind: 'user',
    role: 'user',
    content,
    meta: null,
    createdAt: Date.now(),
  };
}

async function* yieldChunks(chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) yield c;
}

async function* yieldThenThrow(
  chunks: string[],
  err: Error,
): AsyncGenerator<string> {
  for (const c of chunks) yield c;
  throw err;
}

function mkProvider(
  streamImpl: () => AsyncGenerator<string>,
  persona = 'persona-text',
): BaseProvider & { resetConversationContext: ReturnType<typeof vi.fn> } {
  return {
    id: 'p-claude',
    type: 'api',
    displayName: 'Claude',
    persona,
    streamCompletion: streamImpl,
    consumeLastTokenUsage: () => null,
    isReady: () => true,
    resetConversationContext: vi.fn(),
  } as unknown as BaseProvider & {
    resetConversationContext: ReturnType<typeof vi.fn>;
  };
}

describe('DmAutoResponder', () => {
  let channelService: { listMembers: ReturnType<typeof vi.fn> };
  let messageService: {
    listByChannel: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
  };
  let providerLookup: { get: ReturnType<typeof vi.fn> };
  let responder: DmAutoResponder;

  beforeEach(() => {
    channelService = { listMembers: vi.fn().mockReturnValue([dmMember]) };
    messageService = {
      listByChannel: vi.fn().mockReturnValue([mkChannelMessage('hi')]),
      append: vi.fn(),
    };
    providerLookup = { get: vi.fn() };
    responder = new DmAutoResponder({
      channelService,
      messageService,
      providerLookup,
    } as DmAutoResponderDeps);
  });

  it('streams completion and appends the assembled assistant reply', async () => {
    const provider = mkProvider(() => yieldChunks(['hel', 'lo ', 'back']));
    providerLookup.get.mockReturnValue(provider);

    await responder.handle(mkChannelMessage('hi'), dmChannel);

    expect(messageService.append).toHaveBeenCalledTimes(1);
    expect(messageService.append).toHaveBeenCalledWith({
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'p-claude',
      authorKind: 'member',
      role: 'assistant',
      content: 'hello back',
    });
  });

  it('resets the provider conversation context before streaming', async () => {
    const provider = mkProvider(() => yieldChunks(['ok']));
    providerLookup.get.mockReturnValue(provider);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(provider.resetConversationContext).toHaveBeenCalledTimes(1);
  });

  it('passes channel history to streamCompletion in chronological order with empty persona', async () => {
    const stream =
      vi.fn<
        (
          messages: Array<{ role: string; content: string }>,
          persona: string,
        ) => AsyncGenerator<string>
      >((_msgs, _p) => yieldChunks(['ok']));
    const provider = mkProvider(stream as unknown as () => AsyncGenerator<string>);
    providerLookup.get.mockReturnValue(provider);
    // listByChannel returns reverse-chronological (newest first); responder
    // must reverse to chronological for the provider.
    const newest: ChannelMessage = {
      id: 'm-newest',
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: 'newest',
      meta: null,
      createdAt: 3,
    };
    const middle: ChannelMessage = {
      id: 'm-mid',
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'p-claude',
      authorKind: 'member',
      role: 'assistant',
      content: 'middle',
      meta: null,
      createdAt: 2,
    };
    const oldest: ChannelMessage = {
      id: 'm-old',
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: 'oldest',
      meta: null,
      createdAt: 1,
    };
    messageService.listByChannel.mockReturnValue([newest, middle, oldest]);

    await responder.handle(mkChannelMessage('newest'), dmChannel);

    const callArgs = stream.mock.calls[0]!;
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.content)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    // DM 은 회의용 persona 를 사용하지 않으므로 빈 문자열을 전달한다.
    expect(callArgs[1]).toBe('');
  });

  it('appends a system error message when provider streamCompletion throws', async () => {
    const provider = mkProvider(() =>
      yieldThenThrow([], new Error('rate limited')),
    );
    providerLookup.get.mockReturnValue(provider);

    await responder.handle(mkChannelMessage('hi'), dmChannel);

    expect(messageService.append).toHaveBeenCalledTimes(1);
    const arg = messageService.append.mock.calls[0]![0];
    expect(arg).toMatchObject({
      channelId: 'dm-1',
      authorId: 'p-claude',
      authorKind: 'member',
      role: 'system',
    });
    expect(arg.content).toMatch(/응답 실패.*rate limited/);
  });

  it('appends a system error when the provider id is not registered', async () => {
    providerLookup.get.mockReturnValue(undefined);

    await responder.handle(mkChannelMessage('hi'), dmChannel);

    const arg = messageService.append.mock.calls[0]![0];
    expect(arg.role).toBe('system');
    expect(arg.content).toMatch(/not registered/);
  });

  it('warns and noops when channel has no member', async () => {
    channelService.listMembers.mockReturnValue([]);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).not.toHaveBeenCalled();
  });

  it('warns and noops when provider yields no tokens', async () => {
    const provider = mkProvider(() => yieldChunks([]));
    providerLookup.get.mockReturnValue(provider);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).not.toHaveBeenCalled();
  });

  it('drops tool-role messages from the provider history', async () => {
    const stream =
      vi.fn<
        (
          messages: Array<{ role: string; content: string }>,
          persona: string,
        ) => AsyncGenerator<string>
      >((_msgs, _p) => yieldChunks(['ok']));
    const provider = mkProvider(stream as unknown as () => AsyncGenerator<string>);
    providerLookup.get.mockReturnValue(provider);

    const toolRow: ChannelMessage = {
      id: 'm-tool',
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'p-claude',
      authorKind: 'member',
      role: 'tool',
      content: 'tool-output',
      meta: null,
      createdAt: 2,
    };
    const userRow: ChannelMessage = {
      id: 'm-user',
      channelId: 'dm-1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: 'hi',
      meta: null,
      createdAt: 1,
    };
    messageService.listByChannel.mockReturnValue([toolRow, userRow]);

    await responder.handle(mkChannelMessage('hi'), dmChannel);
    const messages = stream.mock.calls[0]![0] as Array<{ content: string }>;
    expect(messages.map((m) => m.content)).toEqual(['hi']);
  });
});
