import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseProvider } from '../../providers/provider-interface';
import type { Message as ProviderMessage } from '../../../shared/provider-types';
import { asAbsolutePath } from '../../../shared/absolute-path';
import { ChatVoteRepository } from '../../meetings/chat-vote-repository';
import { ChatVoteService } from '../../meetings/chat-vote-service';
import { OpinionRepository } from '../../meetings/opinion-repository';
import { CliPromptBuilder } from '../../providers/cli/cli-prompt-builder';
import { directMessageTurnHint } from '../chat-whisper-output';
import {
  createChatRuntime, privateReply, publicReply, reply, whisperTo, type ChatRuntime,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const text = (messages: Array<{ content: string }>): string => messages.map((m) => m.content).join('\n');

describe('CLI recipient keeps its public turn after a private reply (A3)', () => {
  it('lets B answer privately, then speak once in public from its resumed session without re-sent input', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', whisperTo('bob', 'secret plan'), privateReply(null));
    rt.script('bob', privateReply('private ack'), publicReply('bob in public'));
    rt.script('carol', publicReply('carol in public'));

    await rt.sendUser(room, 'U1 discuss');

    expect(rt.publicReplies(room.id, 'bob')).toEqual(['bob in public']);
    expect(rt.notices(room.id)).toEqual([]);
    const [privateCall, publicCall] = rt.callsFor('bob');
    expect(text(privateCall!.messages)).toContain('secret plan');
    expect(privateCall!.hint).toContain('Private reply to ');
    expect(publicCall!.resumed).toBe(`session:${room.id}:bob`);
    expect(publicCall!.messages).toEqual([]);
    expect(publicCall!.hint).toContain('Room turn:');
    const carol = rt.callsFor('carol');
    expect(carol).toHaveLength(1);
    expect(text(carol[0]!.messages)).toContain('U1 discuss');
    expect(text(carol[0]!.messages)).toContain('bob in public');
    expect(text(carol[0]!.messages)).not.toContain('secret plan');
    expect(text(carol[0]!.messages)).not.toContain('private ack');
  });

  it('continues a CLI session when a later user message was already delivered in the previous round', async () => {
    const rt = runtime = createChatRuntime({ cli: ['bob'] });
    const room = rt.createRoom('Room', ['bob']);
    rt.script('bob', publicReply('first answer'), publicReply('second answer'));
    const first = rt.messages.append({ channelId: room.id, meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content: 'U1' });
    const second = rt.messages.append({ channelId: room.id, meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content: 'U2' });

    await rt.responder.handle(first, room);
    await rt.responder.handle(second, room);

    expect(rt.publicReplies(room.id, 'bob')).toEqual(['first answer', 'second answer']);
    const [firstCall, secondCall] = rt.callsFor('bob');
    expect(text(firstCall!.messages)).toContain('U2');
    expect(secondCall!.resumed).toBe(`session:${room.id}:bob`);
    expect(secondCall!.messages).toEqual([]);
    expect(rt.notices(room.id)).toEqual([]);
  });
});

describe('DM turn hint through the real responder path (D2)', () => {
  it('sends the DM hint (not the room hint) on both calls, and the resumed empty-input prompt stays neutral', async () => {
    const rt = runtime = createChatRuntime({ cli: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', publicReply('first answer'), publicReply('second answer'));
    const u1 = rt.messages.append({ channelId: dm.id, meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content: 'U1' });
    const u2 = rt.messages.append({ channelId: dm.id, meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content: 'U2' });

    await rt.responder.handle(u1, dm);
    await rt.responder.handle(u2, dm);

    const hint = directMessageTurnHint();
    const [firstCall, secondCall] = rt.callsFor('bob');
    expect(firstCall!.hint).toBe(hint);
    expect(secondCall!.hint).toBe(hint);
    expect(secondCall!.resumed).not.toBeNull();
    expect(secondCall!.messages).toEqual([]);

    const prompt = new CliPromptBuilder().buildChatDeltaPrompt([], hint);
    expect(prompt).not.toContain('room');
    expect(prompt).not.toContain('new visible activity');
  });
});

describe('chat failure notices stay out of model input (A4)', () => {
  it('shows a failed private reply to the observer only, never to C (CLI delta), D (API) or the vote', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'dave'], cli: ['bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol', 'dave']);
    rt.script('alice', publicReply('alice warmup'), whisperTo('bob', 'secret plan'));
    rt.script('bob', publicReply('bob warmup'), reply('not JSON at all'), publicReply('bob in public'));
    rt.script('carol', publicReply('carol warmup'), publicReply('carol in public'));
    rt.script('dave', publicReply('dave warmup'), publicReply('dave in public'));

    await rt.sendUser(room, 'U0 warmup');
    await rt.sendUser(room, 'U1 discuss');

    const failure = rt.observer(room.id).find((m) => m.role === 'system');
    expect(failure).toMatchObject({ authorId: 'bob', meta: { chatError: 'invalid_response' } });
    expect(rt.messages.searchWithContext('invalid_response', { channelId: room.id },
      { kind: 'observer' }).map((hit) => hit.id)).toEqual([failure!.id]);
    const [, carolDelta] = rt.callsFor('carol');
    expect(carolDelta!.resumed).toBe(`session:${room.id}:carol`);
    expect(carolDelta!.messages.map((m) => m.role)).not.toContain('system');
    expect(text(carolDelta!.messages)).toContain('U1 discuss');
    expect(text(carolDelta!.messages)).toContain('bob in public');
    expect(text(carolDelta!.messages)).not.toContain('invalid_response');
    expect(text(carolDelta!.messages)).not.toContain('secret plan');
    const [, daveHistory] = rt.callsFor('dave');
    expect(text(daveHistory!.messages)).toContain('carol in public');
    expect(text(daveHistory!.messages)).not.toContain('invalid_response');
    expect(daveHistory!.messages.filter((m) => m.role === 'system')).toHaveLength(1);

    const voteCalls: ProviderMessage[][] = [];
    rt.db.prepare(`INSERT INTO opinion(id,meeting_id,channel_id,kind,author_label,title,content,status,round,created_at,updated_at)
      VALUES ('op',NULL,?,'user-raised','user_1','Proposal','Body','pending',0,1,1)`).run(room.id);
    const votes = new ChatVoteService(new ChatVoteRepository(rt.db), new OpinionRepository(rt.db),
      rt.rooms, rt.messages, { get: (id: string) => rt.providers.get(id) },
      (_provider: BaseProvider) => ({
        async *streamCompletion(messages: ProviderMessage[]) {
          voteCalls.push(messages);
          yield '{"opinion":"fine","vote":"agree"}';
        },
        cooldown: vi.fn(async () => undefined),
      }) as never, () => 'C:/chat-consensus', asAbsolutePath('C:/chat-cli-instructions', 'vote test'));
    votes.startVote('op');
    await vi.waitFor(() => expect(votes.getVote('op')?.status).toBe('completed'));
    expect(voteCalls).toHaveLength(4);
    const voteContext = text(voteCalls[0] as Array<{ content: string }>);
    expect(voteContext).toContain('bob in public');
    expect(voteContext).not.toContain('invalid_response');
    expect(voteCalls[0]!.some((m) => m.role === 'system')).toBe(false);
  });
});
