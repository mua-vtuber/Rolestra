import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppendWhisperInput } from '../message-service';
import {
  createChatRuntime, hang, privateReply, publicReply, roomTurn, whisperTo, type ChatRuntime,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

describe('whisper chain lifecycle (W3)', () => {
  it('archiving during a private reply aborts it, drops its late write and makes no further calls', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('alice', roomTurn('hi all', [['bob', 'to bob'], ['carol', 'to carol']]));
    rt.script('bob', async function* () {
      await gate;
      yield '{"reply":"late private reply"}';
    }, publicReply('bob public'));
    rt.script('carol', privateReply('carol reply'), publicReply('carol public'));

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    const source = rt.observer(room.id)[0]!;
    rt.rooms.archive(room.id);
    expect(rt.callsFor('bob')[0]?.signal?.aborted).toBe(true);
    release?.();
    await pending;

    expect(rt.observer(room.id).map((m) => m.content)).toEqual(['U1', 'hi all', 'to bob']);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob']);
    expect(rt.roundStatus(source.id)).toBe('interrupted');
  });

  it('archiving right after a whisper is stored skips its reply and the remaining whispers', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', roomTurn(null, [['bob', 'to bob'], ['carol', 'to carol']]));
    rt.script('bob', privateReply('bob reply'));
    rt.script('carol', privateReply('carol reply'));
    const store = rt.messages.appendWhisper.bind(rt.messages);
    vi.spyOn(rt.messages, 'appendWhisper').mockImplementation((input: AppendWhisperInput) => {
      const row = store(input);
      if (input.recipientId === 'bob') rt.rooms.archive(room.id);
      return row;
    });

    await rt.sendUser(room, 'U1');

    expect(rt.observer(room.id).map((m) => m.content)).toEqual(['U1', 'to bob']);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice']);
    expect(rt.notices(room.id)).toEqual([]);
  });

  it('shutting down during a private reply aborts it and skips the rest of the chain', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob', 'carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('alice', roomTurn(null, [['bob', 'to bob'], ['carol', 'to carol']]));
    rt.script('bob', async function* () {
      await gate;
      yield '{"reply":"late private reply"}';
    });

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    const source = rt.observer(room.id)[0]!;
    const shutdown = rt.responder.shutdown();
    expect(rt.callsFor('bob')[0]?.signal?.aborted).toBe(true);
    release?.();
    await Promise.all([pending, shutdown]);

    expect(rt.observer(room.id).map((m) => m.content)).toEqual(['U1', 'to bob']);
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob']);
    expect(rt.roundStatus(source.id)).toBe('interrupted');
  });

  it('marks a round cut by a crash as interrupted after restart and never calls a model for it again', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'to bob'), publicReply('alice after restart'));
    rt.script('bob', hang(), publicReply('bob after restart'));

    void rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    const source = rt.observer(room.id)[0]!;
    expect(rt.roundStatus(source.id)).toBe('running');

    rt.restart();

    expect(rt.roundStatus(source.id)).toBe('interrupted');
    await rt.responder.handle(source, room);
    expect(rt.calls).toHaveLength(2);
    await rt.sendUser(room, 'U2');
    expect(rt.calls.map((call) => call.providerId)).toEqual(['alice', 'bob', 'alice', 'bob']);
    expect(rt.publicReplies(room.id, 'bob')).toEqual(['bob after restart']);
  });
});
