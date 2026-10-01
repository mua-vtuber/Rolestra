import { afterEach, describe, expect, it } from 'vitest';
import {
  createChatRuntime, privateReply, publicReply, reply, roomTurn, silentTurn, whisperTo,
  type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';
import { participantAlias } from '../participant-alias';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const text = (call: ModelCall | undefined): string => (call?.messages ?? []).map((m) => m.content).join('\n');
/** The hint a model received: CLI adapters get it directly, API calls as the last system message. */
const hintOf = (call: ModelCall | undefined): string | null => call?.kind === 'cli'
  ? call.hint : call?.messages.filter((m) => m.role === 'system').at(-1)?.content ?? null;

describe('free whispers (2026-09-28 rules)', () => {
  it('stores the public message, then each whisper followed by its thread of private replies, in output order', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'], cli: ['carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    // Alice declines to continue each thread (spec 2026-10-01 F2: null ends it).
    rt.script('alice', roomTurn('hello all', [['bob', 'to bob'], ['carol', 'to carol']]),
      privateReply(null), privateReply(null));
    rt.script('bob', privateReply('bob answers'), publicReply('bob public'));
    rt.script('carol', privateReply('carol answers'), publicReply('carol public'));

    await rt.sendUser(room, 'U1');

    const rows = rt.observer(room.id).slice(1);
    expect(rows.map((m) => [m.authorId, m.visibility === 'whisper' ? 'whisper' : m.role, m.content])).toEqual([
      ['alice', 'assistant', 'hello all'],
      ['alice', 'whisper', 'to bob'],
      ['bob', 'whisper', 'bob answers'],
      ['alice', 'whisper', 'to carol'],
      ['carol', 'whisper', 'carol answers'],
      ['bob', 'assistant', 'bob public'],
      ['carol', 'assistant', 'carol public'],
    ]);
    expect(rows[2]?.whisper).toMatchObject({ recipientId: 'alice', replyToMessageId: rows[1]?.id, threadSeq: 2 });
    expect(rows[4]?.whisper).toMatchObject({ recipientId: 'alice', replyToMessageId: rows[3]?.id, threadSeq: 2 });
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'alice', 'carol', 'alice', 'bob', 'carol']);
    expect(hintOf(rt.calls[1])).toContain('Private reply to "ALICE"');
    expect(text(rt.calls[3])).toContain('to carol');
    expect(text(rt.calls[3])).not.toContain('to bob');
    expect(text(rt.calls[3])).not.toContain('bob answers');
    expect(rt.notices(room.id)).toEqual([]);
    // A thread that ends after the first reply ends quietly (2026-10-01 decision).
    expect(rt.silences(room.id)).toEqual([]);
  });

  it('keeps a silent turn and a declined reply as observer-only notices that no AI reads next round', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'carol'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', silentTurn(), publicReply('alice round two'));
    rt.script('bob', whisperTo('carol', 'psst carol'), publicReply('bob round two'));
    rt.script('carol', privateReply(null), publicReply('carol round one'), publicReply('carol round two'));

    await rt.sendUser(room, 'U1');
    await rt.sendUser(room, 'U2');

    expect(rt.silences(room.id)).toEqual(['turn_passed:alice', 'reply_passed:carol']);
    expect(rt.notices(room.id)).toEqual([]);
    const silence = rt.observer(room.id).filter((m) => m.meta?.chatSilence !== undefined);
    expect(silence.map((m) => [m.role, m.authorKind, m.content, m.meta?.chatSilence])).toEqual([
      ['system', 'member', 'turn_passed', { code: 'turn_passed', speakerName: 'ALICE' }],
      ['system', 'member', 'reply_passed', { code: 'reply_passed', speakerName: 'CAROL' }],
    ]);
    const secondRound = rt.calls.slice(-3);
    expect(secondRound.map((call) => call.providerId)).toEqual(['alice', 'bob', 'carol']);
    for (const call of secondRound) {
      expect(text(call)).not.toContain('turn_passed');
      expect(text(call)).not.toContain('reply_passed');
      expect(call.messages.filter((m) => m.role === 'system').length).toBe(call.kind === 'api' ? 1 : 0);
    }
    expect(text(secondRound[0])).not.toContain('psst carol');
    rt.rooms.archive(room.id);
    expect(rt.silences(room.id)).toEqual(['turn_passed:alice', 'reply_passed:carol']);
  });

  // `@bob` stands for bob's alias in this room (models address participants by alias only).
  it.each([
    ['a duplicate recipient', '{"public":"x","whispers":[{"recipientId":"@bob","content":"a"},{"recipientId":"@bob","content":"b"}]}'],
    ['the sender itself', '{"public":"x","whispers":[{"recipientId":"@alice","content":"a"}]}'],
    ['an unknown recipient', '{"public":"x","whispers":[{"recipientId":"@mallory","content":"a"}]}'],
    ['a raw provider id', '{"public":"x","whispers":[{"recipientId":"bob","content":"a"}]}'],
    ['an extra key', '{"public":"x","whispers":[],"mood":"calm"}'],
    ['a forged whisper field', '{"public":null,"whispers":[{"recipientId":"@bob","content":"a","senderId":"@bob"}]}'],
    ['a blank public message', '{"public":"   ","whispers":[]}'],
    ['a blank whisper', '{"public":null,"whispers":[{"recipientId":"@bob","content":" "}]}'],
    ['a missing whispers key', '{"public":"x"}'],
    ['the old single-choice shape', '{"kind":"public","content":"x"}'],
  ])('rejects %s as invalid_response and stores nothing from that turn', async (_label, output) => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', reply(output.replace(/@(\w+)/g, (_m, id: string) => participantAlias(room.id, id))));
    rt.script('bob', publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).slice(1).map((m) => [m.authorId, m.role, m.content])).toEqual([
      ['alice', 'system', 'invalid_response'],
      ['bob', 'assistant', 'bob public'],
    ]);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob']);
  });

  it('gives a third AI the same turn hint whether or not someone whispered earlier in the round', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'dave'], cli: ['carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol', 'dave']);
    rt.script('alice', whisperTo('bob', 'secret one'), privateReply(null), publicReply('alice r2'));
    rt.script('bob', privateReply('secret ack'), publicReply('bob r1'), publicReply('bob r2'));
    rt.script('carol', publicReply('carol r1'), publicReply('carol r2'));
    rt.script('dave', publicReply('dave r1'), publicReply('dave r2'));

    await rt.sendUser(room, 'U1');
    await rt.sendUser(room, 'U2');

    for (const id of ['carol', 'dave']) {
      const [roundOne, roundTwo] = rt.callsFor(id);
      expect(hintOf(roundOne)).toBeTruthy();
      expect(hintOf(roundOne)).toBe(hintOf(roundTwo));
      for (const call of [roundOne, roundTwo]) {
        expect(text(call)).not.toContain('secret one');
        expect(text(call)).not.toContain('secret ack');
      }
    }
    expect(hintOf(rt.callsFor('bob')[1])).toBe(hintOf(rt.callsFor('bob')[2]));
  });

  it('rejects a private reply that tries to whisper, so a reply never starts a new whisper', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', whisperTo('bob', 'first secret'));
    rt.script('bob', reply(JSON.stringify({ public: null,
      whispers: [{ recipientId: participantAlias(room.id, 'carol'), content: 'chain' }] })),
      publicReply('bob public'));
    rt.script('carol', publicReply('carol public'));

    await rt.sendUser(room, 'U1');

    const whispers = rt.observer(room.id).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => m.content)).toEqual(['first secret']);
    expect(rt.notices(room.id)).toEqual(['invalid_response']);
    expect(rt.observer(room.id).find((m) => m.meta?.chatError)?.authorId).toBe('bob');
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'bob', 'carol']);
  });

  it('lets a CLI recipient answer whispers from two senders and still take its own public turn (A3)', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'carol'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'carol', 'bob']);
    rt.script('alice', whisperTo('bob', 'from alice'), privateReply(null));
    rt.script('carol', whisperTo('bob', 'from carol'), privateReply(null));
    rt.script('bob', privateReply('re alice'), privateReply('re carol'), publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    const whispers = rt.observer(room.id).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => [m.authorId, m.whisper?.recipientId, m.content])).toEqual([
      ['alice', 'bob', 'from alice'], ['bob', 'alice', 're alice'],
      ['carol', 'bob', 'from carol'], ['bob', 'carol', 're carol'],
    ]);
    expect(rt.publicReplies(room.id, 'bob')).toEqual(['bob public']);
    const [firstReply, secondReply, turn] = rt.callsFor('bob');
    expect(text(secondReply)).toContain('from carol');
    expect(text(secondReply)).not.toContain('from alice');
    expect(turn?.resumed).toBe(`session:${room.id}:bob`);
    expect(turn?.messages).toEqual([]);
    expect(firstReply?.hint).toContain('Private reply to "ALICE"');
    expect(rt.notices(room.id)).toEqual([]);
  });

  it('skips only the whisper whose recipient disappeared mid-turn; the rest of the turn continues (W10)', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    // Bob's own turn goes first (round order follows room member sortOrder),
    // so he is still registered when he takes it. He is then unregistered as
    // a side effect of alice's turn, right when alice whispers to him — by
    // the time `chat-room-turns.ts`'s `storeRoot` re-checks the live pair for
    // that whisper specifically, the write fails. Bob is still a live,
    // eligible recipient when alice's turn is validated (the recipient list
    // is snapshotted before the model call), so this is a store-time failure,
    // not a validation-time one. Carol's whisper is unaffected and must
    // still be stored, along with her private reply and her own later turn.
    const room = rt.createRoom('Room', ['bob', 'alice', 'carol']);
    rt.script('bob', silentTurn());
    rt.script('alice', async function* () {
      rt.providers.delete('bob');
      yield JSON.stringify({ public: 'hello all', whispers: [
        { recipientId: participantAlias(room.id, 'bob'), content: 'to bob' },
        { recipientId: participantAlias(room.id, 'carol'), content: 'to carol' },
      ] });
    }, privateReply(null));
    rt.script('carol', privateReply('carol answers'), silentTurn());

    await rt.sendUser(room, 'U1');

    expect(rt.publicReplies(room.id, 'alice')).toEqual(['hello all']);
    const notices = rt.observer(room.id).filter((m) => m.role === 'system' && m.meta?.chatError !== undefined);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ authorId: 'alice', meta: { chatError: 'recipient_unavailable' } });
    const whispers = rt.observer(room.id).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => [m.authorId, m.whisper?.recipientId, m.content])).toEqual([
      ['alice', 'carol', 'to carol'], ['carol', 'alice', 'carol answers'],
    ]);
    expect(whispers.some((m) => m.whisper?.recipientId === 'bob' || m.authorId === 'bob')).toBe(false);
  });
});

describe('DM stays plain text (W7)', () => {
  it('stores a DM reply verbatim even when it looks like the room contract, and never passes in silence', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'], cli: ['carol'] });
    const apiDm = rt.channels.createDm('bob');
    const cliDm = rt.channels.createDm('carol');
    rt.script('bob', silentTurn());
    rt.script('carol', reply('plain CLI answer'));

    await rt.sendUser(apiDm, 'hello');
    await rt.sendUser(cliDm, 'hello');

    expect(rt.publicReplies(apiDm.id, 'bob')).toEqual(['{"public":null,"whispers":[]}']);
    expect(rt.publicReplies(cliDm.id, 'carol')).toEqual(['plain CLI answer']);
    expect(rt.silences(apiDm.id)).toEqual([]);
    expect(rt.silences(cliDm.id)).toEqual([]);
    expect(rt.callsFor('carol')[0]?.hint).not.toContain('whispers');
    expect(rt.callsFor('bob')[0]?.messages.some((m) => m.content.includes('whispers'))).toBe(false);
    for (const id of ['bob', 'carol']) expect(rt.callsFor(id)[0]?.persona).not.toContain('whispers');
  });
});
