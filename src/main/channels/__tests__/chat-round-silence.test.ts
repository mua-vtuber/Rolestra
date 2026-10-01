/**
 * All-silent rounds (spec 2026-10-01 F3): when every member's regular turn
 * in a round is silence, the observer gets one code-only notice. Failures and
 * closed rooms never produce it, and no model ever reads it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChatRuntime, privateReply, publicReply, reply, silentTurn, whisperTo, type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const text = (call: ModelCall | undefined): string => (call?.messages ?? []).map((m) => m.content).join('\n');

describe('all-silent round notice (F3)', () => {
  it('stores one observer-only notice after the round when every regular turn was silent', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'carol'], cli: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('alice', silentTurn(), publicReply('alice again'));
    rt.script('bob', silentTurn(), publicReply('bob again'));
    rt.script('carol', silentTurn(), publicReply('carol again'));

    await rt.sendUser(room, 'U1');

    expect(rt.silences(room.id)).toEqual([
      'turn_passed:alice', 'turn_passed:bob', 'turn_passed:carol', 'round_all_silent:system',
    ]);
    const notice = rt.observer(room.id).at(-1);
    expect(notice).toMatchObject({ role: 'system', authorKind: 'system', authorId: 'system',
      content: 'round_all_silent', meta: { chatSilence: { code: 'round_all_silent' } } });
    expect(Object.keys(notice?.meta?.chatSilence ?? {})).toEqual(['code']);

    await rt.sendUser(room, 'U2');
    for (const call of rt.calls.slice(-3)) expect(text(call)).not.toContain('round_all_silent');
    expect(rt.silences(room.id).filter((code) => code.startsWith('round_all_silent'))).toHaveLength(1);
  });

  it('does not count a whisper-only turn as silence, even when its thread ends at once', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', whisperTo('bob', 'psst'));
    rt.script('bob', privateReply(null), silentTurn());

    await rt.sendUser(room, 'U1');

    expect(rt.silences(room.id)).toEqual(['reply_passed:bob', 'turn_passed:bob']);
  });

  it('stores nothing when any member spoke publicly', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', silentTurn());
    rt.script('bob', publicReply('hello'));

    await rt.sendUser(room, 'U1');

    expect(rt.silences(room.id)).toEqual(['turn_passed:alice']);
  });

  it('stores nothing when a turn failed, even if every other turn was silent', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', reply('not json'));
    rt.script('bob', silentTurn());

    await rt.sendUser(room, 'U1');

    expect(rt.notices(room.id)).toEqual(['invalid_response']);
    expect(rt.silences(room.id)).toEqual(['turn_passed:bob']);
  });

  it('stores nothing when the room closes during the round', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('alice', silentTurn());
    rt.script('bob', async function* (call) {
      await gate;
      yield* silentTurn()(call);
    });

    const pending = rt.sendUser(room, 'U1');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    rt.rooms.archive(room.id);
    release?.();
    await pending;

    expect(rt.silences(room.id)).toEqual(['turn_passed:alice']);
  });

  it('never applies to a DM', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', reply('plain answer'));

    await rt.sendUser(dm, 'hello');

    expect(rt.silences(dm.id)).toEqual([]);
  });
});
