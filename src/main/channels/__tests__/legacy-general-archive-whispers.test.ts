import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import type { Message } from '../../../shared/message-types';
import { asAbsolutePath } from '../../../shared/absolute-path';
import type { BaseProvider } from '../../providers/provider-interface';
import { ChatVoteService } from '../../meetings/chat-vote-service';
import type { ChatVoteRepository } from '../../meetings/chat-vote-repository';
import type { OpinionRepository } from '../../meetings/opinion-repository';
import { ChannelService } from '../channel-service';
import type { ChannelRepository } from '../channel-repository';
import { DmAutoResponder, type DmAutoResponderDeps } from '../dm-auto-responder';
import { participantAlias } from '../participant-alias';

const channel = { id: 'general', kind: 'system_general', projectId: null,
  name: 'General' } as Channel;
const user = (id: string): Message => ({ id, channelId: 'general', meetingId: null,
  authorId: 'user', authorKind: 'user', role: 'user', content: id,
  meta: null, createdAt: 1 });

describe('legacy general conversation export', () => {
  it('reopens the general channel after an export failure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rolestra-archive-failure-'));
    try {
      let fail = true;
      const service = new ChannelService(
        { get: () => channel } as unknown as ChannelRepository,
        {
          archiveRoot: { getArenaRoot: () => root },
          archiveMessages: {
            listAllByChannel: () => { if (fail) throw new Error('snapshot failed'); return []; },
            deleteByChannel: () => 0,
          },
        },
      );
      const resume = vi.fn();
      service.setConversationArchiveLifecycle({ pause: async () => undefined, resume });
      await expect(service.archiveConversation('general')).rejects.toThrow('snapshot failed');
      expect(service.isConversationArchiving('general')).toBe(false);
      expect(() => service.assertAppendAllowed('general')).not.toThrow();
      expect(resume).toHaveBeenCalledWith('general');
      fail = false;
      await expect(service.archiveConversation('general')).resolves.toMatchObject({ deletedCount: 0 });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('drains active and queued whispers, exports private metadata, then accepts a new conversation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rolestra-archive-whisper-'));
    try {
      const rows: Message[] = [user('old-user'), {
        id: 'old-whisper', channelId: 'general', meetingId: null,
        authorId: 'alice', authorKind: 'member', role: 'assistant',
        content: 'old private note', meta: null, createdAt: 2,
        visibility: 'whisper', whisper: {
          recipientId: 'bob', senderName: 'Alice', recipientName: 'Bob',
          sourceMessageId: 'old-user', replyToMessageId: null, threadSeq: 1,
        },
      }, user('queued-user')];
      const channelService = new ChannelService(
        { get: () => channel } as unknown as ChannelRepository,
        {
          archiveRoot: { getArenaRoot: () => root },
          archiveMessages: {
            listAllByChannel: () => [...rows],
            deleteByChannel: () => { const count = rows.length; rows.length = 0; return count; },
          },
        },
      );
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const stream = vi.fn(async function* () {
        if (stream.mock.calls.length === 1) await gate;
        yield stream.mock.calls.length === 1
          ? JSON.stringify({ public: null, whispers: [
            { recipientId: participantAlias('general', 'bob'), content: 'late private note' }] })
          : '{"public":"new conversation reply","whispers":[]}';
      });
      const alice = { id: 'alice', type: 'api', displayName: 'Alice', persona: '',
        resetConversationContext: vi.fn(), streamCompletion: stream } as unknown as BaseProvider;
      const bob = { id: 'bob', type: 'api', displayName: 'Bob', persona: '',
        resetConversationContext: vi.fn(),
        streamCompletion: vi.fn(async function* () { yield '{"public":"Bob","whispers":[]}'; }),
      } as unknown as BaseProvider;
      const append = vi.fn((input: Partial<Message>) => {
        channelService.assertAppendAllowed('general');
        const row = { id: `appended-${rows.length}`, meta: null, createdAt: rows.length + 3,
          ...input } as Message;
        rows.push(row); return row;
      });
      const appendWhisper = vi.fn((input: { content: string }) => {
        channelService.assertAppendAllowed('general');
        throw new Error(`unexpected whisper append: ${input.content}`);
      });
      const responder = new DmAutoResponder({
        channelService: { get: (id: string) => channelService.get(id),
          listMembers: () => [{ providerId: 'alice' }, { providerId: 'bob' }] },
        messageService: { append, appendWhisper,
          listByChannel: () => [...rows].reverse() },
        providerLookup: { get: (id: string) => id === 'alice' ? alice : id === 'bob' ? bob : undefined },
        memberProfileLookup: { getProfile: () => ({ characterSheet: '' }) },
        consensusPath: () => root,
        roundRepository: { claim: () => true, finish: vi.fn(), interrupt: vi.fn(),
          interruptChannel: vi.fn(), interruptRunning: vi.fn() },
      } as unknown as DmAutoResponderDeps);
      const interruptVote = vi.fn();
      const voteService = new ChatVoteService(
        { interruptRunning: vi.fn(), interruptChannel: interruptVote } as unknown as ChatVoteRepository,
        { get: () => ({ channelId: 'general', meetingId: null, kind: 'user-raised' }) } as unknown as OpinionRepository,
        { get: () => null, listMembers: () => [] },
        { listByChannel: () => [] },
        { get: () => undefined, listInstances: () => [] },
        () => { throw new Error('vote must not start'); }, () => root,
        asAbsolutePath(path.join(root, 'app-data', 'chat-cli-instructions'), 'archive test'),
        (id) => channelService.get(id)?.kind === 'system_general' &&
          !channelService.isConversationArchiving(id),
      );
      channelService.setConversationArchiveLifecycle({
        pause: (id) => { voteService.interruptChannel(id); return responder.pauseRoom(id); },
        resume: (id) => responder.resumeRoom(id),
      });

      const active = responder.handle(user('old-user'), channel);
      await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
      const queued = responder.handle(user('queued-user'), channel);
      const archive = channelService.archiveConversation('general');
      expect(channelService.isConversationArchiving('general')).toBe(true);
      expect(interruptVote).toHaveBeenCalledOnce();
      expect(() => channelService.assertAppendAllowed('general')).toThrow();
      expect(() => voteService.startVote('old-opinion')).toThrow(/not found/);
      await archive;
      release?.();
      await Promise.all([active, queued]);
      expect(stream).toHaveBeenCalledOnce();
      expect(appendWhisper).not.toHaveBeenCalled();
      const result = await archive;
      const dump = JSON.parse(await fs.readFile(result.archivedPath, 'utf8')) as {
        messages: Message[]; messageCount: number;
      };
      expect(dump.messageCount).toBe(3);
      expect(dump.messages[1]).toMatchObject({ visibility: 'whisper',
        whisper: { recipientId: 'bob', sourceMessageId: 'old-user', replyToMessageId: null },
      });
      expect(rows).toHaveLength(0);
      expect(channelService.isConversationArchiving('general')).toBe(false);

      const fresh = user('fresh-user');
      rows.push(fresh);
      await responder.handle(fresh, channel);
      expect(stream).toHaveBeenCalledTimes(2);
      expect(append.mock.calls.some((call) => call[0].content === 'new conversation reply')).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
