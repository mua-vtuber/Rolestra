/**
 * Pass turn (spec 2026-10-01 F1): the user moves the conversation on without
 * writing anything. A code-only user row is the round's source; models read it
 * as one plain line and the round hint asks for new content or silence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_PASS_CODE } from '../../../shared/message-types';
import { ChatPassRejectedError } from '../chat-pass-service';
import { CHAT_PASS_MODEL_LINE } from '../chat-whisper-output';
import {
  createChatRuntime, hintOf, publicReply, silentTurn, type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const text = (call: ModelCall | undefined): string => (call?.messages ?? []).map((m) => m.content).join('\n');
const PASS_HINT = 'The user passed without adding anything. Speak only if you have something new to say; otherwise stay silent.';

function rejection(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof ChatPassRejectedError)) throw error;
    return error.code;
  }
}

describe('pass turn (F1)', () => {
  it('stores a code-only user row and runs one round that models read as a pass line', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', publicReply('alice first'), publicReply('alice after pass'));
    rt.script('bob', publicReply('bob first'), silentTurn());

    await rt.sendUser(room, 'U1');
    await rt.passTurn(room);

    const pass = rt.observer(room.id).find((m) => m.meta?.chatPass !== undefined);
    expect(pass).toMatchObject({ authorId: 'user', authorKind: 'user', role: 'user', visibility: 'public',
      content: CHAT_PASS_CODE, meta: { chatPass: CHAT_PASS_CODE } });
    expect(rt.roundStatus(pass!.id)).toBe('finished');
    expect(rt.publicReplies(room.id, 'alice')).toEqual(['alice first', 'alice after pass']);

    const [aliceFirst, aliceAfter] = rt.callsFor('alice');
    const [bobFirst, bobAfter] = rt.callsFor('bob');
    expect(text(aliceAfter)).toContain(`[Speaker: "User"]\n${CHAT_PASS_MODEL_LINE}`);
    expect(bobAfter?.resumed).toBe(`session:${room.id}:bob`);
    expect(text(bobAfter)).toContain(`[Speaker: "User"]\n${CHAT_PASS_MODEL_LINE}`);
    for (const call of [aliceAfter, bobAfter]) {
      expect(text(call)).not.toContain(CHAT_PASS_CODE);
      expect(hintOf(call)).toContain(PASS_HINT);
    }
    for (const call of [aliceFirst, bobFirst]) expect(hintOf(call)).not.toContain(PASS_HINT);
  });

  it('lets the AIs start talking in an empty room', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', publicReply('opening line'));
    rt.script('bob', silentTurn());

    await rt.passTurn(room);

    expect(rt.publicReplies(room.id, 'alice')).toEqual(['opening line']);
    const [aliceCall] = rt.callsFor('alice');
    expect(aliceCall?.messages.filter((m) => m.role !== 'system').map((m) => m.content))
      .toEqual([`[Speaker: "User"]\n${CHAT_PASS_MODEL_LINE}`]);
  });

  it('rejects a DM, an archived room and a room with a running or queued round, storing nothing', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const dm = rt.channels.createDm('bob');
    const room = rt.createRoom('Room', ['alice']);
    const archived = rt.createRoom('Old room', ['alice']);
    rt.rooms.archive(archived.id);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('alice', async function* (call) {
      await gate;
      yield* publicReply('slow answer')(call);
    }, publicReply('queued answer'), publicReply('after pass'));

    expect(rejection(() => rt.passTurn(dm))).toBe('dm_channel');
    expect(rejection(() => rt.passTurn(archived))).toBe('room_archived');
    const running = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('alice')).toHaveLength(1));
    expect(rejection(() => rt.passTurn(room))).toBe('round_running');
    const queued = rt.sendUser(room, 'U2');
    release?.();
    await running;
    expect(rejection(() => rt.passTurn(room))).toBe('round_running');
    await queued;
    await rt.passTurn(room);

    for (const channel of [dm, archived]) {
      expect(rt.observer(channel.id).some((m) => m.meta?.chatPass !== undefined)).toBe(false);
    }
    expect(rt.observer(room.id).filter((m) => m.meta?.chatPass !== undefined)).toHaveLength(1);
    expect(rt.publicReplies(room.id, 'alice')).toEqual(['slow answer', 'queued answer', 'after pass']);
  });

  it('rejects a general channel without participants, storing nothing (QA m5)', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.channels.ensureGlobalGeneralChannel();

    expect(rejection(() => rt.passTurn(general))).toBe('no_participants');
    expect(rt.observer(general.id)).toEqual([]);
  });

  it('keeps pass rows out of search while ordinary words still match', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Room', ['alice']);
    rt.script('alice', silentTurn(), silentTurn());

    await rt.sendUser(room, 'please pass the salt');
    await rt.passTurn(room);

    const hits = rt.messages.searchWithContext('pass', { channelId: room.id }, { kind: 'observer' });
    expect(hits.map((hit) => hit.content)).toEqual(['please pass the salt']);
    expect(rt.messages.search('user', { channelId: room.id })).toEqual([]);
  });
});
