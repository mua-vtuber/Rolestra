import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import type { Message } from '../../../shared/message-types';
import type { BaseProvider } from '../../providers/provider-interface';
import { DmAutoResponder, type DmAutoResponderDeps } from '../dm-auto-responder';
import { ChatOutputLimitError, collectChatOutput } from '../chat-whisper-output';
import { participantAlias } from '../participant-alias';

const channel = { id: 'room', kind: 'user', projectId: null } as Channel;
const source = { id: 'user-1', channelId: 'room', meetingId: null,
  authorId: 'user', authorKind: 'user', role: 'user', content: 'Discuss privately if useful',
  meta: null, createdAt: 1 } as Message;
const members = ['alice', 'bob', 'carol'].map((providerId) => ({
  providerId, displayName: providerId.toUpperCase(), channelId: 'room',
}));
/** Whisper recipients are given by provider id and written as the model sees them: by alias. */
const turn = (publicText: string | null, whispers: Array<[string, string]> = []): string =>
  JSON.stringify({ public: publicText, whispers: whispers.map(([providerId, content]) =>
    ({ recipientId: participantAlias(channel.id, providerId), content })) });
const OK_TURN = turn('OK');

function setup(outputs: Record<string, string[]>) {
  const rows: Message[] = [source];
  const calls: Array<{ id: string; messages: Array<{ content: string }> }> = [];
  const providers = new Map<string, BaseProvider>();
  for (const id of ['alice', 'bob', 'carol']) {
    providers.set(id, {
      id, type: 'api', displayName: id.toUpperCase(), persona: '',
      resetConversationContext: vi.fn(),
      streamCompletion: vi.fn(async function* (messages: Array<{ content: string }>) {
        calls.push({ id, messages });
        yield outputs[id]?.shift() ?? OK_TURN;
      }),
    } as unknown as BaseProvider);
  }
  const append = vi.fn((input: Partial<Message>) => {
    const row = { id: `public-${rows.length}`, meta: null, createdAt: rows.length + 1,
      ...input } as Message;
    rows.push(row);
    return row;
  });
  const appendWhisper = vi.fn((input: {
    channelId: string; authorId: string; recipientId: string; content: string;
    senderName: string; recipientName: string; sourceMessageId: string;
    replyToMessageId: string | null;
    threadSeq?: number;
  }) => {
    const row: Message = {
      id: `private-${rows.length}`, channelId: input.channelId, meetingId: null,
      authorId: input.authorId, authorKind: 'member', role: 'assistant',
      content: input.content, meta: null, createdAt: rows.length + 1,
      visibility: 'whisper', whisper: {
        recipientId: input.recipientId, senderName: input.senderName,
        recipientName: input.recipientName, sourceMessageId: input.sourceMessageId,
        replyToMessageId: input.replyToMessageId, threadSeq: input.threadSeq ?? 1,
      },
    };
    rows.push(row);
    return row;
  });
  // Mirrors `messageVisibilitySql` for a provider viewer: stored system rows
  // never reach a model, and a whisper only reaches its two participants.
  const listByChannel = vi.fn((_channelId: string, _opts: unknown,
    viewer: { kind: 'provider'; providerId: string }) => rows.filter((message) =>
      message.role !== 'system' && (message.visibility !== 'whisper' || message.authorId === viewer.providerId ||
      message.whisper?.recipientId === viewer.providerId)).reverse());
  const claimed = new Set<string>();
  const roundRepository = {
    claim: vi.fn((_channelId: string, sourceId: string) => {
      if (claimed.has(sourceId)) return false;
      claimed.add(sourceId); return true;
    }),
    finish: vi.fn(), interrupt: vi.fn(), interruptChannel: vi.fn(), interruptRunning: vi.fn(),
  };
  let archivedAt: number | null = null;
  let deleted = false;
  const roomService = {
    get: () => deleted ? null : ({ archivedAt }), listMembers: () => members,
    getEffectivePersona: () => 'Room persona', assertActive: () => undefined,
  };
  const responder = new DmAutoResponder({
    channelService: { get: () => deleted ? null : channel, listMembers: () => members },
    messageService: { append, appendWhisper, listByChannel },
    providerLookup: { get: (id: string) => providers.get(id) },
    memberProfileLookup: { getProfile: vi.fn() },
    consensusPath: () => '/consensus', roomService, roundRepository,
  } as unknown as DmAutoResponderDeps);
  return { responder, rows, append, appendWhisper, listByChannel, calls,
    roundRepository, providers, archive: () => { archivedAt = 1; },
    deleteRoom: () => { deleted = true; rows.length = 0; } };
}

/** Failure notices only; silence notices are system rows too but carry `chatSilence`. */
const errorCodes = (run: ReturnType<typeof setup>): unknown[] =>
  run.append.mock.calls.filter((call) => call[0].role === 'system' && call[0].meta?.chatError !== undefined)
    .map((call) => call[0].meta?.chatError);

describe('whispers with the 2026-09-28 rules', () => {
  it('saves one root and its private reply, and keeps both out of a third provider context', async () => {
    const setupResult = setup({
      alice: [turn(null, [['bob', 'secret plan']]), '{"reply":null}'],
      bob: ['{"reply":"private ack"}', turn('room reply')],
      carol: [turn('carol reply')],
    });
    await setupResult.responder.handle(source, channel);
    expect(setupResult.appendWhisper).toHaveBeenCalledTimes(2);
    expect(setupResult.appendWhisper.mock.calls[0]?.[0]).toMatchObject({
      authorId: 'alice', recipientId: 'bob', sourceMessageId: 'user-1', replyToMessageId: null,
    });
    expect(setupResult.appendWhisper.mock.calls[1]?.[0]).toMatchObject({
      authorId: 'bob', recipientId: 'alice', sourceMessageId: 'user-1',
      replyToMessageId: 'private-1', content: 'private ack',
    });
    const bobCalls = setupResult.calls.filter((call) => call.id === 'bob');
    expect(bobCalls).toHaveLength(2);
    expect(bobCalls[0]?.messages.map((m) => m.content).join('\n')).toContain('secret plan');
    expect(bobCalls[0]?.messages.map((m) => m.content).join('\n')).toContain('Private reply to ');
    const carol = setupResult.calls.find((call) => call.id === 'carol');
    expect(carol?.messages.map((m) => m.content).join('\n')).not.toContain('secret plan');
    expect(carol?.messages.map((m) => m.content).join('\n')).not.toContain('private ack');
    expect(setupResult.listByChannel.mock.calls.every((call) => call[2]?.kind === 'provider')).toBe(true);
    await setupResult.responder.handle(source, channel);
    expect(setupResult.calls.map((call) => call.id)).toEqual(['alice', 'bob', 'alice', 'bob', 'carol']);
    expect(setupResult.roundRepository.finish).toHaveBeenCalledWith('room', 'user-1');
  });

  it('never persists malformed output or forged recipients as public content', async () => {
    const run = setup({ alice: [turn('looks fine', [['outsider', 'secret']])],
      bob: ['not JSON'], carol: [turn('ok')] });
    await run.responder.handle(source, channel);
    expect(run.appendWhisper).not.toHaveBeenCalled();
    expect(errorCodes(run)).toEqual(['invalid_response', 'invalid_response']);
    expect(JSON.stringify(run.rows)).not.toContain('secret');
    expect(JSON.stringify(run.rows)).not.toContain('looks fine');
    expect(JSON.stringify(run.rows)).not.toContain('not JSON');
  });

  it('rejects a reply that tries to whisper, while the recipient may still whisper in its own turn', async () => {
    const run = setup({
      alice: [turn(null, [['bob', 'first secret']])],
      bob: [turn(null, [['carol', 'chain secret']]), turn(null, [['carol', 'own turn secret']]), '{"reply":null}'],
      carol: ['{"reply":"carol answers"}', turn('hello')],
    });
    await run.responder.handle(source, channel);
    expect(run.appendWhisper.mock.calls.map((call) => [call[0].authorId, call[0].recipientId, call[0].content]))
      .toEqual([['alice', 'bob', 'first secret'], ['bob', 'carol', 'own turn secret'],
        ['carol', 'bob', 'carol answers']]);
    expect(errorCodes(run)).toEqual(['invalid_response']);
    expect(JSON.stringify(run.rows)).not.toContain('chain secret');
  });

  it('rejects a removed or self recipient before saving a root', async () => {
    const removed = setup({ alice: [turn(null, [['bob', 'private after removal']])] });
    const alice = removed.providers.get('alice')!;
    alice.streamCompletion = vi.fn(async function* () {
      removed.providers.delete('bob');
      yield turn(null, [['bob', 'private after removal']]);
    });
    await removed.responder.handle(source, channel);
    expect(removed.appendWhisper).not.toHaveBeenCalled();
    expect(errorCodes(removed)).toContain('recipient_unavailable');
    expect(JSON.stringify(removed.rows)).not.toContain('private after removal');

    const self = setup({ alice: [turn(null, [['alice', 'self secret']])] });
    await self.responder.handle(source, channel);
    expect(self.appendWhisper).not.toHaveBeenCalled();
    expect(errorCodes(self)).toContain('invalid_response');
  });

  it('does not resurrect a deleted room after a root while the recipient reply is pending', async () => {
    const run = setup({ alice: [turn(null, [['bob', 'root secret']])] });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bob = run.providers.get('bob')!;
    const recipientStream = vi.fn(async function* () {
      await gate;
      yield '{"reply":"late private reply"}';
    });
    bob.streamCompletion = recipientStream;
    const pending = run.responder.handle(source, channel);
    await vi.waitFor(() => expect(recipientStream).toHaveBeenCalledOnce());
    expect(run.appendWhisper).toHaveBeenCalledOnce();
    run.archive();
    run.deleteRoom();
    run.responder.closeRoom('room');
    release?.();
    await pending;
    expect(run.appendWhisper).toHaveBeenCalledOnce();
    expect(run.rows).toEqual([]);
    expect(run.append).not.toHaveBeenCalled();
    expect(run.calls.some((call) => call.id === 'carol')).toBe(false);
    expect(run.roundRepository.interruptChannel).toHaveBeenCalledWith('room');
  });

  it('reports a generic timeout when a provider never yields or honors abort', async () => {
    vi.useFakeTimers();
    try {
      const run = setup({});
      const alice = run.providers.get('alice')!;
      alice.streamCompletion = vi.fn(async function* () {
        await new Promise<never>(() => undefined);
        yield 'unreachable private output';
      });
      const pending = run.responder.handle(source, channel);
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
      expect(run.append.mock.calls.some((call) => call[0].meta?.chatError === 'timeout')).toBe(true);
      expect(run.appendWhisper).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops late output and queued work when a room closes', async () => {
    const run = setup({});
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const alice = run.providers.get('alice')!;
    const stream = vi.fn(async function* () {
      await gate;
      yield turn(null, [['bob', 'late secret']]);
    });
    alice.streamCompletion = stream;
    const first = run.responder.handle(source, channel);
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
    const queued = run.responder.handle({ ...source, id: 'user-2' }, channel);
    run.archive();
    run.responder.closeRoom('room');
    release?.();
    await Promise.all([first, queued]);
    expect(run.appendWhisper).not.toHaveBeenCalled();
    expect(run.roundRepository.interruptChannel).toHaveBeenCalledWith('room');
    expect(stream).toHaveBeenCalledOnce();
  });

  it('rejects output beyond 64 KiB before it can be parsed or stored', async () => {
    async function* oversized() { yield 'x'.repeat(65_537); }
    await expect(collectChatOutput(oversized())).rejects.toBeInstanceOf(ChatOutputLimitError);
  });
});
