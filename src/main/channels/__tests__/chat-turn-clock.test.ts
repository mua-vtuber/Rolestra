import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  after, createChatRuntime, emptyReply, hang, publicReply, whitespaceReply, type ChatRuntime,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  vi.useRealTimers();
  runtime?.close();
  runtime = null;
});

describe('chat turn clock (A1)', () => {
  it('does not charge a queued CLI turn for the time another room spends on the shared CLI queue', async () => {
    vi.useFakeTimers();
    const rt = runtime = createChatRuntime({ cli: ['alice'] });
    const roomX = rt.createRoom('X', ['alice']);
    const roomY = rt.createRoom('Y', ['alice']);
    rt.script('alice', after(45_000, publicReply('X reply')), after(30_000, publicReply('Y reply')));

    const x = rt.sendUser(roomX, 'hello X');
    const y = rt.sendUser(roomY, 'hello Y');
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([x, y]);

    expect(rt.publicReplies(roomX.id, 'alice')).toEqual(['X reply']);
    expect(rt.publicReplies(roomY.id, 'alice')).toEqual(['Y reply']);
    expect(rt.notices(roomX.id)).toEqual([]);
    expect(rt.notices(roomY.id)).toEqual([]);
  });

  it('times a CLI turn from its own start and reports a timeout once it runs past the limit', async () => {
    vi.useFakeTimers();
    const rt = runtime = createChatRuntime({ cli: ['alice'] });
    const roomX = rt.createRoom('X', ['alice']);
    const roomY = rt.createRoom('Y', ['alice']);
    rt.script('alice', hang(), hang());

    const x = rt.sendUser(roomX, 'hello X');
    const y = rt.sendUser(roomY, 'hello Y');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rt.notices(roomX.id)).toEqual(['timeout']);
    expect(rt.notices(roomY.id)).toEqual([]);
    expect(rt.callsFor('alice')).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(rt.notices(roomY.id)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([x, y]);
    expect(rt.notices(roomY.id)).toEqual(['timeout']);
    expect(rt.callsFor('alice').every((call) => call.signal?.aborted)).toBe(true);
  });
});

describe('empty chat output (A2)', () => {
  it('shows invalid_response when an open room gets no CLI or API content', async () => {
    const rt = runtime = createChatRuntime({ cli: ['alice'], api: ['bob'] });
    const room = rt.createRoom('Room', ['alice', 'bob']);
    rt.script('alice', emptyReply());
    rt.script('bob', emptyReply());

    await rt.sendUser(room, 'anyone there?');

    expect(rt.observer(room.id).filter((m) => m.role === 'system').map((m) => [m.authorId, m.meta?.chatError]))
      .toEqual([['alice', 'invalid_response'], ['bob', 'invalid_response']]);
  });

  it('shows invalid_response for an empty DM reply', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', emptyReply());

    await rt.sendUser(dm, 'hello');

    expect(rt.notices(dm.id)).toEqual(['invalid_response']);
  });

  it('shows invalid_response for a whitespace-only API DM reply and stores no assistant row', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', whitespaceReply());

    await rt.sendUser(dm, 'hello');

    expect(rt.notices(dm.id)).toEqual(['invalid_response']);
    expect(rt.publicReplies(dm.id, 'bob')).toEqual([]);
  });

  it('shows invalid_response for a whitespace-only CLI DM reply and persists no session row', async () => {
    const rt = runtime = createChatRuntime({ cli: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', whitespaceReply());

    await rt.sendUser(dm, 'hello');

    expect(rt.notices(dm.id)).toEqual(['invalid_response']);
    expect(rt.publicReplies(dm.id, 'bob')).toEqual([]);
    expect(rt.db.prepare('SELECT COUNT(*) AS n FROM cli_chat_sessions WHERE channel_id = ?')
      .get(dm.id)).toEqual({ n: 0 });
  });

  it('stays silent when the room closes while its CLI turn runs or waits in the queue', async () => {
    vi.useFakeTimers();
    const rt = runtime = createChatRuntime({ cli: ['alice'] });
    const roomX = rt.createRoom('X', ['alice']);
    const roomY = rt.createRoom('Y', ['alice']);
    rt.script('alice', hang());

    const x = rt.sendUser(roomX, 'hello X');
    const y = rt.sendUser(roomY, 'hello Y');
    await vi.advanceTimersByTimeAsync(10_000);
    rt.rooms.archive(roomY.id);
    rt.rooms.archive(roomX.id);
    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.all([x, y]);

    expect(rt.notices(roomX.id)).toEqual([]);
    expect(rt.notices(roomY.id)).toEqual([]);
    expect(rt.callsFor('alice')).toHaveLength(1);
  });
});
