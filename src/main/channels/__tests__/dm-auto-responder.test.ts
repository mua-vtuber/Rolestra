import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelMember } from '../../../shared/channel-types';
import { catalogDefaultForNullRole } from '../../../shared/permission-set-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import type { BaseProvider } from '../../providers/provider-interface';
import { DmAutoResponder, type DmAutoResponderDeps } from '../dm-auto-responder';
import { participantAlias } from '../participant-alias';
import { PermissionBoundaryError } from '../../files/permission-service';
import type { Project } from '../../../shared/project-types';
import type { MemberProfile } from '../../../shared/member-profile-types';

const CONSENSUS_PATH = '/arena/consensus';

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
  maxRounds: null,
  permissions: catalogDefaultForNullRole(),
};

const dmMember: ChannelMember = {
  channelId: 'dm-1',
  projectId: null,
  providerId: 'p-claude',
  dragOrder: null,
};

const projectDmChannel: Channel = {
  ...dmChannel,
  projectId: 'pr-1',
};

const project: Project = {
  id: 'pr-1',
  slug: 'alpha',
  name: 'Alpha',
  description: '',
  kind: 'new',
  externalLink: null,
  permissionMode: 'hybrid',
  autonomyMode: 'manual',
  status: 'active',
  createdAt: 1,
  archivedAt: null,
};

const defaultProfile: MemberProfile = {
  providerId: 'p-claude',
  characterSheet: 'Role: friend\nPersonality: curious\nExpertise: conversation',
  avatarKind: 'default',
  avatarData: null,
  statusOverride: null,
  updatedAt: 0,
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
  streamImpl: (
    messages: unknown,
    persona: string,
    options?: unknown,
  ) => AsyncGenerator<string>,
  persona = 'persona-text',
  id = 'p-claude',
  displayName = 'Claude',
): BaseProvider & { resetConversationContext: ReturnType<typeof vi.fn> } {
  return {
    id,
    type: 'api',
    displayName,
    persona,
    streamCompletion: streamImpl,
    consumeLastTokenUsage: () => null,
    isReady: () => true,
    resetConversationContext: vi.fn(),
  } as unknown as BaseProvider & {
    resetConversationContext: ReturnType<typeof vi.fn>;
  };
}

/**
 * CLI 직원 — R12-X T4 부터 workspace 를 넘겨받아야 spawn 한다.
 * `isCliProvider` 는 `type === 'cli'` + CLI 전용 method 존재로 판정한다.
 */
function mkCliProvider(
  streamImpl: (
    messages: unknown,
    persona: string,
    options?: unknown,
  ) => AsyncGenerator<string>,
): BaseProvider {
  return {
    id: 'p-claude',
    type: 'cli',
    displayName: 'Claude CLI',
    persona: '',
    streamCompletion: streamImpl,
    consumeLastTokenUsage: () => null,
    isReady: () => true,
    resetConversationContext: vi.fn(),
    setPermissionRequestCallback: vi.fn(),
  } as unknown as BaseProvider;
}

describe('DmAutoResponder', () => {
  let channelService: { listMembers: ReturnType<typeof vi.fn> };
  let messageService: {
    listByChannel: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
  };
  let providerLookup: { get: ReturnType<typeof vi.fn> };
  let memberProfileLookup: { getProfile: ReturnType<typeof vi.fn> };
  let cliWorkspaceResolver: { resolveForCli: ReturnType<typeof vi.fn> };
  let consensusPath: ReturnType<typeof vi.fn>;
  let responder: DmAutoResponder;

  beforeEach(() => {
    channelService = { listMembers: vi.fn().mockReturnValue([dmMember]) };
    messageService = {
      listByChannel: vi.fn().mockReturnValue([mkChannelMessage('hi')]),
      append: vi.fn(),
    };
    providerLookup = { get: vi.fn() };
    memberProfileLookup = {
      getProfile: vi.fn().mockReturnValue(defaultProfile),
    };
    cliWorkspaceResolver = {
      resolveForCli: vi.fn().mockReturnValue({
        cwd: '/arena/projects/alpha/cwd',
        consensusPath: CONSENSUS_PATH,
        project,
      }),
    };
    consensusPath = vi.fn().mockReturnValue(CONSENSUS_PATH);
    responder = new DmAutoResponder({
      channelService,
      messageService,
      providerLookup,
      memberProfileLookup,
      cliWorkspaceResolver,
      consensusPath,
    } as unknown as DmAutoResponderDeps);
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

  it('uses a system author when a frozen room participant provider was removed', async () => {
    providerLookup.get.mockReturnValue(undefined);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'system', authorKind: 'system', role: 'system',
    }));
  });

  it('does not append an error after a room archives during generation', async () => {
    let archivedAt: number | null = null;
    const provider = mkProvider(async function* () {
      archivedAt = 1;
      yield* [];
      throw new Error('generation interrupted');
    });
    providerLookup.get.mockReturnValue(provider);
    const roomService = {
      get: () => ({ ...dmChannel, archivedAt }),
      listMembers: () => [{ ...dmMember, displayName: 'Claude' }],
      getEffectivePersona: () => 'Frozen persona',
      assertActive: () => { if (archivedAt !== null) throw new Error('Room archived'); },
    };
    const roomResponder = new DmAutoResponder({
      channelService, messageService, providerLookup, memberProfileLookup,
      consensusPath, roomService,
    } as unknown as DmAutoResponderDeps);
    await roomResponder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).not.toHaveBeenCalled();
  });

  it('does not start a queued reply after shutdown', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stream = vi.fn(async function* () {
      await gate;
      yield 'late reply';
    });
    providerLookup.get.mockReturnValue(mkProvider(stream));
    const first = responder.handle(mkChannelMessage('first'), dmChannel);
    for (let n = 0; n < 5; n += 1) await Promise.resolve();
    const second = responder.handle(mkChannelMessage('second'), dmChannel);
    const shutdown = responder.shutdown();
    release?.();
    await Promise.all([first, second, shutdown]);
    expect(stream).toHaveBeenCalledOnce();
    expect(messageService.append).not.toHaveBeenCalled();
  });

  it('uses the room creation persona snapshot for an API provider', async () => {
    const stream = vi.fn((_messages: unknown, _persona: string, _options?: unknown,
      _signal?: AbortSignal) => yieldChunks(['{"public":"ok","whispers":[]}']));
    providerLookup.get.mockReturnValue(mkProvider(stream as never));
    const room = { ...dmChannel, id: 'room-a', kind: 'user' as const, archivedAt: null };
    const roomService = {
      get: () => room,
      listMembers: () => [{ ...dmMember, channelId: 'room-a', displayName: 'Frozen Alice' }],
      getEffectivePersona: () => 'Frozen persona at creation',
      assertActive: () => undefined,
    };
    const roomResponder = new DmAutoResponder({
      channelService, messageService, providerLookup, memberProfileLookup,
      consensusPath, roomService,
    } as unknown as DmAutoResponderDeps);
    await roomResponder.handle(mkChannelMessage('hi'), room);
    expect(stream.mock.calls[0]?.[1]).toContain('Frozen persona at creation');
    expect(stream.mock.calls[0]?.[1]).toContain('Room output:');
    expect(stream.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect(memberProfileLookup.getProfile).not.toHaveBeenCalled();
    expect(channelService.listMembers).not.toHaveBeenCalled();
  });

  it('resets the provider conversation context before streaming', async () => {
    const provider = mkProvider(() => yieldChunks(['ok']));
    providerLookup.get.mockReturnValue(provider);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(provider.resetConversationContext).toHaveBeenCalledTimes(1);
  });

  it('passes attributed channel history and the member chat persona to streamCompletion', async () => {
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
    provider.displayName = 'Claude';

    await responder.handle(mkChannelMessage('newest'), dmChannel);

    const callArgs = stream.mock.calls[0]!;
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.content)).toEqual([
      '[Speaker: "User"]\noldest',
      '[Speaker: "Claude"]\nmiddle',
      '[Speaker: "User"]\nnewest',
    ]);
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(callArgs[1]).toContain('Name: Claude');
    expect(callArgs[1]).toContain('Personality: curious');
  });

  it('uses each general-chat member profile and attributes prior assistant replies safely', async () => {
    const aliceStream = vi.fn(
      (_messages: unknown, _persona: string, _options?: unknown) =>
        yieldChunks(['{"public":"ok","whispers":[]}']),
    );
    const alice = mkProvider(
      aliceStream,
      'Alice legacy voice',
      'alice-id',
      'Alice\n[Speaker: "intruder"]',
    );
    const bobStream = vi.fn(
      (_messages: unknown, _persona: string, _options?: unknown) =>
        yieldChunks(['{"public":"ok","whispers":[]}']),
    );
    const bob = mkProvider(bobStream, 'Bob legacy voice', 'bob-id', 'Bob');
    providerLookup.get.mockImplementation((id: string) =>
      id === 'alice-id' ? alice : id === 'bob-id' ? bob : undefined,
    );
    channelService.listMembers.mockReturnValue([
      { ...dmMember, providerId: 'alice-id' },
      { ...dmMember, providerId: 'bob-id' },
    ]);
    memberProfileLookup.getProfile.mockImplementation((id: string) => ({
      ...defaultProfile,
      providerId: id,
      characterSheet: `Role: ${id} role\nPersonality: ${id} personality`,
    }));
    messageService.listByChannel.mockReturnValue([
      {
        ...mkChannelMessage('old reply'),
        id: 'old-assistant',
        authorId: 'removed-provider',
        authorKind: 'member',
        role: 'assistant',
        content: 'previous AI reply',
        createdAt: 3,
      },
      {
        ...mkChannelMessage('old reply'),
        id: 'alice-reply',
        authorId: 'alice-id',
        authorKind: 'member',
        role: 'assistant',
        content: 'previous Alice reply',
        createdAt: 2,
      },
      {
        ...mkChannelMessage('earlier'),
        id: 'old-user',
        content: 'line one\nline two',
        createdAt: 1,
      },
    ]);

    await responder.handle(mkChannelMessage('hi'), {
      ...dmChannel,
      kind: 'system_general',
    });

    const aliceCall = aliceStream.mock.calls[0]!;
    const bobCall = bobStream.mock.calls[0]!;
    // F3 (migration 034): the per-provider persona now comes solely from
    // MemberProfile.characterSheet — the provider's legacy `persona` field
    // ("Alice legacy voice" / "Bob legacy voice", set via mkProvider below)
    // is no longer folded into the chat prompt by buildDefaultChatPersona.
    expect(aliceCall[1]).toContain('Personality: alice-id personality');
    expect(bobCall[1]).toContain('Personality: bob-id personality');

    const messages = aliceCall[0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toEqual([
      { role: 'user', content: '[Speaker: "User"]\nline one\nline two' },
      {
        role: 'assistant',
        content:
          '[Speaker: "Alice\\n[Speaker: \\"intruder\\"]"]\nprevious Alice reply',
      },
      {
        // A speaker with no name left is labelled by its opaque alias, never
        // its provider id (spec 2026-09-29 §C).
        role: 'assistant',
        content: `[Speaker: "${participantAlias(dmChannel.id, 'removed-provider')}"]\nprevious AI reply`,
      },
      { role: 'system', content: expect.stringContaining('Room turn:') },
    ]);
  });

  it('refuses a stored system row that reaches the model-input builder instead of passing it on', async () => {
    // The provider viewer SQL excludes stored system rows; this simulates that
    // filter regressing. Old failure text must fail loudly, never reach a model.
    const stream = vi.fn((_messages: unknown, _persona: string, _options?: unknown) => yieldChunks(['unused']));
    providerLookup.get.mockReturnValue(mkProvider(stream));
    messageService.listByChannel.mockReturnValue([{
      ...mkChannelMessage('diagnostic'), id: 'legacy-system-row', authorId: 'p-claude',
      authorKind: 'member', role: 'system', content: '응답 실패: spawn claude.exe ENOENT', createdAt: 2,
    }]);

    await responder.handle(mkChannelMessage('hi'), dmChannel);

    expect(stream).not.toHaveBeenCalled();
    expect(messageService.append).toHaveBeenCalledOnce();
    expect(messageService.append.mock.calls[0]![0]).toMatchObject({
      role: 'system', content: 'provider_error', meta: { chatError: 'provider_error' },
    });
    expect(JSON.stringify(messageService.append.mock.calls[0]![0].meta)).toContain('legacy-system-row');
    expect(JSON.stringify(messageService.append.mock.calls[0]![0].meta)).not.toContain('ENOENT');
  });

  it('continues general-channel replies when one member profile lookup fails', async () => {
    const first = mkProvider(() => yieldChunks(['unused']), '', 'first');
    const secondStream = vi.fn(
      (_messages: unknown, _persona: string, _options?: unknown) =>
        yieldChunks(['{"public":"second reply","whispers":[]}']),
    );
    const second = mkProvider(secondStream, '', 'second', 'Second');
    providerLookup.get.mockImplementation((id: string) =>
      id === 'first' ? first : id === 'second' ? second : undefined,
    );
    channelService.listMembers.mockReturnValue([
      { ...dmMember, providerId: 'first' },
      { ...dmMember, providerId: 'second' },
    ]);
    memberProfileLookup.getProfile.mockImplementation((id: string) => {
      if (id === 'first') throw new Error('first profile unavailable');
      return { ...defaultProfile, providerId: id };
    });

    await expect(
      responder.handle(mkChannelMessage('hi'), {
        ...dmChannel,
        kind: 'system_general',
      }),
    ).resolves.toBeUndefined();

    expect(messageService.append).toHaveBeenCalledTimes(2);
    expect(messageService.append.mock.calls[0]![0]).toMatchObject({
      authorId: 'first',
      role: 'system',
    });
    expect(messageService.append.mock.calls[1]![0]).toMatchObject({
      authorId: 'second',
      role: 'assistant',
      content: 'second reply',
    });
    expect(secondStream).toHaveBeenCalledTimes(1);
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
      content: 'provider_error',
      meta: { chatError: 'provider_error', chatErrorDetail: 'rate limited' },
    });
  });

  it('surfaces a profile lookup failure through the DM system message', async () => {
    const provider = mkProvider(() => yieldChunks(['unused']));
    providerLookup.get.mockReturnValue(provider);
    memberProfileLookup.getProfile.mockImplementation(() => {
      throw new Error('profile unavailable');
    });

    await expect(
      responder.handle(mkChannelMessage('hi'), dmChannel),
    ).resolves.toBeUndefined();

    expect(messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: 'provider_error',
        meta: { chatError: 'provider_error', chatErrorDetail: 'profile unavailable' },
      }),
    );
  });

  it('appends a system error when the provider id is not registered', async () => {
    providerLookup.get.mockReturnValue(undefined);

    await responder.handle(mkChannelMessage('hi'), dmChannel);

    const arg = messageService.append.mock.calls[0]![0];
    expect(arg).toMatchObject({
      role: 'system', content: 'provider_unavailable',
      meta: { chatError: 'provider_unavailable' },
    });
  });

  it('warns and noops when channel has no member', async () => {
    channelService.listMembers.mockReturnValue([]);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).not.toHaveBeenCalled();
  });

  it('reports invalid_response when the provider yields no tokens', async () => {
    const provider = mkProvider(() => yieldChunks([]));
    providerLookup.get.mockReturnValue(provider);
    await responder.handle(mkChannelMessage('hi'), dmChannel);
    expect(messageService.append).toHaveBeenCalledOnce();
    expect(messageService.append.mock.calls[0]![0]).toMatchObject({
      role: 'system', content: 'invalid_response', meta: { chatError: 'invalid_response' },
    });
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
    expect(messages.map((m) => m.content)).toEqual(['[Speaker: "User"]\nhi']);
  });
});

describe('DmAutoResponder — CLI workspace (R12-X T4)', () => {
  let channelService: { listMembers: ReturnType<typeof vi.fn> };
  let messageService: {
    listByChannel: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
  };
  let providerLookup: { get: ReturnType<typeof vi.fn> };
  let memberProfileLookup: { getProfile: ReturnType<typeof vi.fn> };
  let cliWorkspaceResolver: { resolveForCli: ReturnType<typeof vi.fn> };
  let consensusPath: ReturnType<typeof vi.fn>;

  function build(): DmAutoResponder {
    const cliSessionCoordinator = {
      respond: async (input: {
        provider: BaseProvider;
        persona: string;
        options: unknown;
        appendReply: (content: string) => unknown;
        signal?: AbortSignal;
      }): Promise<string | null> => {
        let content = '';
        for await (const token of input.provider.streamCompletion(
          [{ role: 'user', content: 'hi' }], input.persona,
          input.options as never, input.signal,
        )) content += token;
        if (content) input.appendReply(content);
        return content || null;
      },
      closeRoom: async () => undefined,
      shutdown: async () => undefined,
    };
    return new DmAutoResponder({
      channelService,
      messageService,
      providerLookup,
      memberProfileLookup,
      cliWorkspaceResolver,
      consensusPath,
      cliSessionCoordinator,
    } as unknown as DmAutoResponderDeps);
  }

  beforeEach(() => {
    channelService = { listMembers: vi.fn().mockReturnValue([dmMember]) };
    messageService = {
      listByChannel: vi.fn().mockReturnValue([mkChannelMessage('hi')]),
      append: vi.fn(),
    };
    providerLookup = { get: vi.fn() };
    memberProfileLookup = {
      getProfile: vi.fn().mockReturnValue(defaultProfile),
    };
    cliWorkspaceResolver = {
      resolveForCli: vi.fn().mockReturnValue({
        cwd: '/arena/projects/alpha/cwd',
        consensusPath: CONSENSUS_PATH,
        project,
      }),
    };
    consensusPath = vi.fn().mockReturnValue(CONSENSUS_PATH);
  });

  it('legacy project-linked DM also uses the bounded chat workspace', async () => {
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['ok']),
    );
    providerLookup.get.mockReturnValue(
      mkCliProvider(stream as unknown as never),
    );

    await build().handle(mkChannelMessage('hi'), projectDmChannel);

    expect(cliWorkspaceResolver.resolveForCli).not.toHaveBeenCalled();
    expect(stream.mock.calls[0]![2]).toEqual({
      cliWorkspace: {
        scope: 'consensus-only',
        cwd: CONSENSUS_PATH,
        consensusPath: CONSENSUS_PATH,
        projectId: null,
      },
    });
  });

  it('legacy DM permissions cannot expand chat CLI workspace', async () => {
    const permissions = {
      fileRead: true,
      fileWrite: false,
      commandExec: false,
      webSearch: true,
      dbRead: false,
    };
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['ok']),
    );
    providerLookup.get.mockReturnValue(
      mkCliProvider(stream as unknown as never),
    );

    await build().handle(mkChannelMessage('hi'), {
      ...projectDmChannel,
      permissions,
    });

    const options = stream.mock.calls[0]![2] as {
      cliWorkspace: { scope: string; permissions?: unknown };
    };
    expect(options.cliWorkspace.scope).toBe('consensus-only');
    expect(options.cliWorkspace.permissions).toBeUndefined();
  });

  it('프로젝트 없는 DM 은 합의 폴더에서 CLI 를 띄운다', async () => {
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['ok']),
    );
    providerLookup.get.mockReturnValue(
      mkCliProvider(stream as unknown as never),
    );

    await build().handle(mkChannelMessage('hi'), dmChannel);

    expect(cliWorkspaceResolver.resolveForCli).not.toHaveBeenCalled();
    expect(stream.mock.calls[0]![2]).toEqual({
      cliWorkspace: {
        scope: 'consensus-only',
        cwd: CONSENSUS_PATH,
        consensusPath: CONSENSUS_PATH,
        projectId: null,
      },
    });
  });

  it('CLI 가 아닌 직원에게는 workspace 를 붙이지 않는다', async () => {
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['ok']),
    );
    providerLookup.get.mockReturnValue(
      mkProvider(stream as unknown as () => AsyncGenerator<string>),
    );

    await build().handle(mkChannelMessage('hi'), projectDmChannel);

    expect(stream.mock.calls[0]![2]).toBeUndefined();
    expect(cliWorkspaceResolver.resolveForCli).not.toHaveBeenCalled();
  });

  it('legacy project resolver failure cannot block chat', async () => {
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['ok']),
    );
    providerLookup.get.mockReturnValue(
      mkCliProvider(stream as unknown as never),
    );
    cliWorkspaceResolver.resolveForCli.mockImplementation(() => {
      throw new PermissionBoundaryError('Project folder missing: alpha');
    });

    await build().handle(mkChannelMessage('hi'), projectDmChannel);

    expect(cliWorkspaceResolver.resolveForCli).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledOnce();
    expect(messageService.append).toHaveBeenCalledTimes(1);
    const arg = messageService.append.mock.calls[0]![0];
    expect(arg.role).toBe('assistant');
  });

  it('refuses a restored unknown CLI before starting completion', async () => {
    const stream = vi.fn(
      (_m: unknown, _p: string, _o?: unknown): AsyncGenerator<string> =>
        yieldChunks(['unsafe']),
    );
    const provider = mkCliProvider(stream as unknown as never);
    provider.config = {
      type: 'cli', command: 'unknown-helper', args: ['--dangerous'],
      inputFormat: 'args', outputFormat: 'raw-stdout',
      sessionStrategy: 'per-turn', hangTimeout: { first: 1000, subsequent: 1000 },
      model: 'unknown',
    };
    providerLookup.get.mockReturnValue(provider);
    await build().handle(mkChannelMessage('hi'), dmChannel);
    expect(stream).not.toHaveBeenCalled();
    expect(messageService.append.mock.calls[0]?.[0]).toMatchObject({
      role: 'system', content: 'provider_error',
      meta: { chatError: 'provider_error', chatErrorDetail: 'Unsupported chat CLI provider' },
    });
  });

  it('CLI 실행 폴더를 못 정하면 DM 에 오류로 보인다', async () => {
    providerLookup.get.mockReturnValue(
      mkCliProvider((() => yieldChunks(['ok'])) as unknown as never),
    );
    consensusPath.mockImplementation(() => {
      throw new Error('[arena-root] consensus folder unavailable: EACCES');
    });

    await build().handle(mkChannelMessage('hi'), dmChannel);

    const arg = messageService.append.mock.calls[0]![0];
    expect(arg).toMatchObject({
      role: 'system', content: 'provider_error', meta: { chatError: 'provider_error' },
    });
    expect(arg.meta.chatErrorDetail).toMatch(/consensus folder unavailable/);
  });
});
