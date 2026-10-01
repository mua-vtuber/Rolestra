/**
 * Whisper threads (spec 2026-10-01 F2): a root whisper and alternating
 * private replies, at most CHAT_WHISPER_THREAD_MAX_MESSAGES rows per thread.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from '../chat-limits';
import type { AppendWhisperInput } from '../message-service';
import { participantAlias } from '../participant-alias';
import {
  createChatRuntime, hintOf, privateReply, publicReply, reply, roomTurn, silentTurn, whisperTo,
  type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const text = (call: ModelCall | undefined): string => (call?.messages ?? []).map((m) => m.content).join('\n');

describe('whisper threads (F2)', () => {
  it('alternates the two sides up to the limit, then stops asking and moves to the next member', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', whisperTo('bob', 't1 alice'), privateReply('t3 alice'));
    rt.script('bob', privateReply('t2 bob'), privateReply('t4 bob'), publicReply('bob public'));
    rt.script('carol', publicReply('carol public'));

    await rt.sendUser(room, 'U1');

    const whispers = rt.observer(room.id).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => [m.authorId, m.whisper?.recipientId, m.content, m.whisper?.threadSeq]))
      .toEqual([
        ['alice', 'bob', 't1 alice', 1], ['bob', 'alice', 't2 bob', 2],
        ['alice', 'bob', 't3 alice', 3], ['bob', 'alice', 't4 bob', 4],
      ]);
    expect(whispers).toHaveLength(CHAT_WHISPER_THREAD_MAX_MESSAGES);
    const rootId = whispers[0]?.id;
    expect(whispers.slice(1).every((m) => m.whisper?.replyToMessageId === rootId)).toBe(true);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'alice', 'bob', 'bob', 'carol']);
    const [, firstReply, secondReply, thirdReply] = rt.calls;
    expect(hintOf(firstReply)).toContain('Private reply to "ALICE"');
    expect(hintOf(firstReply)).not.toContain('answered you');
    expect(hintOf(secondReply)).toContain('Private reply to "BOB"');
    expect(hintOf(secondReply)).toContain('answered you');
    expect(hintOf(thirdReply)).toContain('Private reply to "ALICE"');
    expect(hintOf(thirdReply)).toContain('answered you');
    expect(text(secondReply)).toContain('t2 bob');
    expect(text(thirdReply)).toContain('t3 alice');
    expect(rt.notices(room.id)).toEqual([]);
    expect(rt.silences(room.id)).toEqual([]);
  });

  it('ends the thread quietly when a later reply is null (only a declined first reply is noted)', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'root'), privateReply(null));
    rt.script('bob', privateReply('answer'), publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).filter((m) => m.visibility === 'whisper').map((m) => m.content))
      .toEqual(['root', 'answer']);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'alice', 'bob']);
    expect(rt.silences(room.id)).toEqual([]);
  });

  it('finishes each thread before the next whisper of the same turn and before the next member', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', roomTurn(null, [['bob', 'to bob'], ['carol', 'to carol']]),
      privateReply('alice to bob again'), privateReply('alice to carol again'));
    rt.script('bob', privateReply('bob answers'), privateReply(null), silentTurn());
    rt.script('carol', privateReply('carol answers'), privateReply('carol last'), silentTurn());

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).slice(1).map((m) => [m.authorId,
      m.visibility === 'whisper' ? 'whisper' : m.role, m.content])).toEqual([
      ['alice', 'whisper', 'to bob'], ['bob', 'whisper', 'bob answers'],
      ['alice', 'whisper', 'alice to bob again'],
      ['alice', 'whisper', 'to carol'], ['carol', 'whisper', 'carol answers'],
      ['alice', 'whisper', 'alice to carol again'], ['carol', 'whisper', 'carol last'],
      ['bob', 'system', 'turn_passed'], ['carol', 'system', 'turn_passed'],
    ]);
    expect(rt.calls.map((call) => call.providerId))
      .toEqual(['alice', 'bob', 'alice', 'bob', 'carol', 'alice', 'carol', 'bob', 'carol']);
  });

  it('ends the thread with a notice when a reply fails, and the round goes on', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'root'), reply('not json'));
    rt.script('bob', privateReply('answer'), publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).filter((m) => m.visibility === 'whisper').map((m) => m.content))
      .toEqual(['root', 'answer']);
    expect(rt.notices(room.id)).toEqual(['invalid_response']);
    expect(rt.observer(room.id).find((m) => m.meta?.chatError)?.authorId).toBe('alice');
    expect(rt.publicReplies(room.id, 'bob')).toEqual(['bob public']);
  });

  it('never lets a later reply start a whisper to a third AI', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', whisperTo('bob', 'root'), reply(JSON.stringify({ public: null,
      whispers: [{ recipientId: participantAlias(room.id, 'carol'), content: 'chain to carol' }] })));
    rt.script('bob', privateReply('answer'), silentTurn());
    rt.script('carol', silentTurn());

    await rt.sendUser(room, 'U1');

    const whispers = rt.observer(room.id).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => m.content)).toEqual(['root', 'answer']);
    expect(whispers.some((m) => m.authorId === 'carol' || m.whisper?.recipientId === 'carol')).toBe(false);
    expect(rt.notices(room.id)).toEqual(['invalid_response']);
  });

  it('stops the thread and the round when the room is archived during a later reply', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('alice', whisperTo('bob', 'root'), async function* () {
      await gate;
      yield '{"reply":"late third"}';
    });
    rt.script('bob', privateReply('answer'));

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('alice')).toHaveLength(2));
    const source = rt.observer(room.id)[0]!;
    rt.rooms.archive(room.id);
    release?.();
    await pending;

    expect(rt.observer(room.id).map((m) => m.content)).toEqual(['U1', 'root', 'answer']);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'alice']);
    expect(rt.roundStatus(source.id)).toBe('interrupted');
  });

  it('ends the thread without another model call when a side was removed after a reply', async () => {
    const rt = runtime = createChatRuntime({ api: ['carol', 'alice', 'bob'] });
    const room = rt.createRoom('Room', ['carol', 'alice', 'bob']);
    rt.script('carol', silentTurn());
    rt.script('alice', whisperTo('bob', 'root'), privateReply('to a removed partner'));
    rt.script('bob', privateReply('answer'));
    const store = rt.messages.appendWhisper.bind(rt.messages);
    vi.spyOn(rt.messages, 'appendWhisper').mockImplementation((input: AppendWhisperInput) => {
      const row = store(input);
      if (input.threadSeq === 2) rt.providers.delete('bob');
      return row;
    });

    await rt.sendUser(room, 'U1');

    expect(rt.calls.map((call) => call.providerId)).toEqual(['carol', 'alice', 'bob']);
    expect(rt.observer(room.id).filter((m) => m.visibility === 'whisper').map((m) => m.content))
      .toEqual(['root', 'answer']);
    // Only bob's own regular turn reports him missing; nothing blames alice.
    expect(rt.observer(room.id).filter((m) => m.meta?.chatError !== undefined)
      .map((m) => [m.authorId, m.meta?.chatError])).toEqual([['system', 'provider_unavailable']]);
  });

  it('names the real cause when the other side disappears during a reply', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'root'), async function* () {
      rt.providers.delete('bob');
      yield '{"reply":"too late"}';
    });
    rt.script('bob', privateReply('answer'));

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).filter((m) => m.visibility === 'whisper').map((m) => m.content))
      .toEqual(['root', 'answer']);
    expect(rt.observer(room.id).filter((m) => m.meta?.chatError !== undefined)
      .map((m) => [m.authorId, m.meta?.chatError])).toEqual([
      ['alice', 'recipient_unavailable'], ['system', 'provider_unavailable'],
    ]);
  });

  it('gives CLI participants each new reply as unseen input on their resumed session', async () => {
    const rt = runtime = createChatRuntime({ cli: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'cli root'), privateReply('cli third'));
    rt.script('bob', privateReply('cli second'), privateReply(null), silentTurn());

    await rt.sendUser(room, 'U1');

    const [, aliceThird] = rt.callsFor('alice');
    const [bobSecond, bobFourth] = rt.callsFor('bob');
    // Each new row is delivered exactly once; nothing already seen is re-sent (QA m1c).
    const count = (call: ModelCall | undefined, needle: string): number => text(call).split(needle).length - 1;
    expect(aliceThird?.resumed).toBe(`session:${room.id}:alice`);
    expect(count(aliceThird, 'cli second')).toBe(1);
    expect(count(aliceThird, 'cli root')).toBe(0);
    expect(count(bobSecond, 'cli root')).toBe(1);
    expect(bobFourth?.resumed).toBe(`session:${room.id}:bob`);
    expect(count(bobFourth, 'cli third')).toBe(1);
    expect(count(bobFourth, 'cli second')).toBe(0);
    expect(rt.notices(room.id)).toEqual([]);
  });
});

describe('whisper thread privacy (rule 8)', () => {
  it('keeps every row of a thread out of a third AI\'s input, hint and later rounds', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'dave'], cli: ['bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol', 'dave']);
    const secrets = ['thread one', 'thread two', 'thread three', 'thread four'];
    rt.script('alice', whisperTo('bob', secrets[0]!), privateReply(secrets[2]!), publicReply('alice r2'));
    rt.script('bob', privateReply(secrets[1]!), privateReply(secrets[3]!), publicReply('bob r1'),
      publicReply('bob r2'));
    rt.script('carol', publicReply('carol r1'), publicReply('carol r2'));
    rt.script('dave', publicReply('dave r1'), publicReply('dave r2'));

    await rt.sendUser(room, 'U1');
    await rt.sendUser(room, 'U2');

    expect(rt.observer(room.id).filter((m) => m.visibility === 'whisper')).toHaveLength(4);
    for (const id of ['carol', 'dave']) {
      const [roundOne, roundTwo] = rt.callsFor(id);
      expect(hintOf(roundOne)).toBe(hintOf(roundTwo));
      for (const call of [roundOne, roundTwo]) {
        const seen = `${text(call)}\n${hintOf(call) ?? ''}\n${call?.persona ?? ''}`;
        for (const secret of secrets) expect(seen).not.toContain(secret);
        expect(seen).not.toContain('[Private');
        expect(seen).not.toContain('reply_passed');
      }
      const visible = rt.messages.listByChannel(room.id, { limit: 200 }, { kind: 'provider', providerId: id });
      expect(visible.some((m) => m.visibility === 'whisper')).toBe(false);
    }
  });
});
