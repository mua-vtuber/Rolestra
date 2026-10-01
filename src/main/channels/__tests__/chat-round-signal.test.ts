/**
 * Round-level signal (QA M1 on spec 2026-10-01 F1/F5): a channel's round is
 * active from the moment the responder gets its first pending entry until
 * that entry is gone, so the pass button never re-enables between turns.
 * A closed room clears its round and writing state at once (QA m6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_RESPONSE_TIMEOUT_MS } from '../chat-limits';
import {
  createChatRuntime, hang, privateReply, publicReply, whisperTo, type ChatRuntime,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

function gate(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

/** Lets pending promise chains run without touching (possibly faked) timers. */
async function settleUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500 && !condition(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error('Condition not reached');
}

describe('chat round signal (QA M1)', () => {
  it('opens before the first call and closes after the last idle', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', publicReply('a'));
    rt.script('bob', publicReply('b'));

    await rt.sendUser(room, 'U1');

    expect(rt.timeline(room.id)).toEqual([
      'round:true', 'alice:writing', 'alice:idle', 'bob:queued', 'bob:writing', 'bob:idle', 'round:false',
    ]);
    expect(rt.responder.activeRoundChannelIds()).toEqual([]);
  });

  it('stays open across a queued second round and between its turns', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Room', ['alice']);
    const first = gate();
    rt.script('alice', async function* (call) {
      await first.wait;
      yield* publicReply('first')(call);
    }, publicReply('second'));

    const running = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('alice')).toHaveLength(1));
    expect(rt.responder.activeRoundChannelIds()).toEqual([room.id]);
    const queued = rt.sendUser(room, 'U2');
    first.release();
    await Promise.all([running, queued]);

    expect(rt.timeline(room.id)).toEqual([
      'round:true', 'alice:writing', 'alice:idle', 'alice:writing', 'alice:idle', 'round:false',
    ]);
  });

  it('closes when the round throws', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Room', ['alice']);
    vi.spyOn(rt.rooms, 'listMembers').mockImplementationOnce(() => { throw new Error('member lookup failed'); });

    await expect(rt.sendUser(room, 'U1')).rejects.toThrow('member lookup failed');

    expect(rt.timeline(room.id)).toEqual(['round:true', 'round:false']);
    expect(rt.responder.activeRoundChannelIds()).toEqual([]);
  });

  it('clears writing and round state the moment a room closes, without repeating them later (QA m6)', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Room', ['alice']);
    const slow = gate();
    rt.script('alice', async function* (call) {
      await slow.wait;
      yield* publicReply('late')(call);
    });

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('alice')).toHaveLength(1));
    rt.rooms.archive(room.id);
    expect(rt.timeline(room.id)).toEqual(['round:true', 'alice:writing', 'alice:idle', 'round:false']);
    expect(rt.responder.activeRoundChannelIds()).toEqual([]);
    slow.release();
    await pending;

    expect(rt.timeline(room.id)).toEqual(['round:true', 'alice:writing', 'alice:idle', 'round:false']);
  });

  it('never reports writing for a CLI turn whose room closed while it waited in the CLI queue (QA m1b, m6)', async () => {
    const rt = runtime = createChatRuntime({ cli: ['alice', 'bob'] });
    const roomA = rt.createRoom('A', ['alice']);
    const roomB = rt.createRoom('B', ['bob']);
    const busy = gate();
    rt.script('alice', async function* (call) {
      await busy.wait;
      yield* publicReply('alice done')(call);
    });

    const first = rt.sendUser(roomA, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('alice')).toHaveLength(1));
    const second = rt.sendUser(roomB, 'U2');
    await vi.waitFor(() => expect(rt.timeline(roomB.id)).toContain('bob:queued'));
    rt.rooms.archive(roomB.id);
    expect(rt.timeline(roomB.id)).toEqual(['round:true', 'bob:queued', 'bob:idle', 'round:false']);
    busy.release();
    await Promise.all([first, second]);

    expect(rt.timeline(roomB.id)).toEqual(['round:true', 'bob:queued', 'bob:idle', 'round:false']);
    expect(rt.callsFor('bob')).toEqual([]);
    expect(rt.publicReplies(roomA.id, 'alice')).toEqual(['alice done']);
  });

  it('reports idle and a timeout notice when the third row of a thread times out (QA m1b)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
      const room = rt.createRoom('Room', ['alice', 'bob']);
      rt.script('alice', whisperTo('bob', 'root'), hang());
      rt.script('bob', privateReply('answer'), publicReply('bob public'));

      const pending = rt.sendUser(room, 'U1');
      await settleUntil(() => rt.callsFor('alice').length === 2);
      await vi.advanceTimersByTimeAsync(CHAT_RESPONSE_TIMEOUT_MS);
      await pending;

      expect(rt.observer(room.id).filter((m) => m.meta?.chatError !== undefined)
        .map((m) => [m.authorId, m.meta?.chatError])).toEqual([['alice', 'timeout']]);
      expect(rt.timeline(room.id)).toEqual([
        'round:true', 'alice:writing', 'alice:idle', 'bob:writing', 'bob:idle',
        'alice:writing', 'alice:idle', 'bob:writing', 'bob:idle', 'round:false',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
