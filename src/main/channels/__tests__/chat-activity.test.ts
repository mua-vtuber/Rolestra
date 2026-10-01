/**
 * Writing / queued activity (spec 2026-10-01 F5): every provider call of a
 * chat turn reports queued (CLI only) and writing, and always ends with idle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChatRuntime, privateReply, publicReply, reply, whisperTo, type ChatRuntime,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const steps = (rt: ChatRuntime): string[] => rt.activity.map((event) =>
  `${event.providerId}:${event.kind}${event.kind === 'whisper' ? `>${event.peerProviderId}` : ''}:${event.phase}`);

describe('chat activity events (F5)', () => {
  it('reports writing then idle for an API turn and queued, writing, idle for a CLI turn', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', publicReply('alice public'));
    rt.script('bob', publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    expect(steps(rt)).toEqual([
      'alice:turn:writing', 'alice:turn:idle',
      'bob:turn:queued', 'bob:turn:writing', 'bob:turn:idle',
    ]);
    expect(rt.activity.every((event) => event.channelId === room.id)).toBe(true);
    expect(rt.activity.some((event) => 'peerProviderId' in event)).toBe(false);
  });

  it('names the other side of every private reply in a whisper thread', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'root'), privateReply(null));
    rt.script('bob', privateReply('answer'), publicReply('bob public'));

    await rt.sendUser(room, 'U1');

    expect(steps(rt)).toEqual([
      'alice:turn:writing', 'alice:turn:idle',
      'bob:whisper>alice:writing', 'bob:whisper>alice:idle',
      'alice:whisper>bob:writing', 'alice:whisper>bob:idle',
      'bob:turn:writing', 'bob:turn:idle',
    ]);
  });

  it('ends with idle when a turn fails or its provider is gone', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', async function* () {
      rt.providers.delete('bob');
      yield* reply('not json')({} as never);
    });

    await rt.sendUser(room, 'U1');

    expect(rt.notices(room.id)).toEqual(['invalid_response', 'provider_unavailable']);
    expect(steps(rt)).toEqual([
      'alice:turn:writing', 'alice:turn:idle',
      'bob:turn:writing', 'bob:turn:idle',
    ]);
  });

  it('ends with idle when the room closes during a turn, and reports nothing after', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['bob', 'alice']);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('bob', async function* (call) {
      await gate;
      yield* publicReply('late')(call);
    });

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    rt.rooms.archive(room.id);
    release?.();
    await pending;

    expect(steps(rt)).toEqual(['bob:turn:queued', 'bob:turn:writing', 'bob:turn:idle']);
  });

  it('reports a DM reply as a turn', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', reply('plain answer'));

    await rt.sendUser(dm, 'hello');

    expect(steps(rt)).toEqual(['bob:turn:writing', 'bob:turn:idle']);
    expect(rt.activity.every((event) => event.channelId === dm.id)).toBe(true);
  });
});
