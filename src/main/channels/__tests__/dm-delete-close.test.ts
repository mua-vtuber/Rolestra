import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleChannelDelete, setDmChannelServiceAccessor } from '../../ipc/handlers/channel-handler';
import { clearLoggerAccessor, setLoggerAccessor } from '../../log/logger-accessor';
import { StructuredLogger } from '../../log/structured-logger';
import { DmAutoResponder, type DmAutoResponderDeps } from '../dm-auto-responder';
import { DmChannelService } from '../dm-channel-service';
import { createChatRuntime, type ChatRuntime } from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

describe('DM delete closes the conversation (A6)', () => {
  it('aborts the in-flight DM reply, rejects its late write and drops the DM CLI clone', async () => {
    const rt = runtime = createChatRuntime({ cli: ['bob'] });
    setDmChannelServiceAccessor(() => rt.dms);
    const dm = rt.channels.createDm('bob');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('bob', async function* () {
      await gate;
      yield 'late DM reply';
    });

    const pending = rt.sendUser(dm, 'hello');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    const append = vi.spyOn(rt.messages, 'append');
    expect(handleChannelDelete({ id: dm.id })).toEqual({ success: true });

    expect(rt.callsFor('bob')[0]!.signal?.aborted).toBe(true);
    release?.();
    await pending;
    expect(append).not.toHaveBeenCalled();
    expect(rt.channels.get(dm.id)).toBeNull();
    // D5: this is the coordinator dropping the DM's clone key from its
    // registry — `cooldown()` only runs where `closeRoom` first deletes the
    // clone entry (chat-session-coordinator.ts), so this is a real proxy
    // for "the clone is gone," not a row count that holds regardless of the
    // close path (a `cli_chat_sessions` count of 0 would hold even without
    // this fix — ON DELETE CASCADE removes it, and every turn already
    // invalidates its own checkpoint before running).
    await vi.waitFor(() => expect(rt.cooldowns).toEqual(['bob']));
  });

  it('announces the close only after the DM row is gone, and never for other channels', () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    const room = rt.createRoom('Room', ['bob']);
    const service = new DmChannelService(rt.channels);
    const seen: Array<{ channelId: string; stillStored: boolean }> = [];
    service.on('closed', ({ channelId }: { channelId: string }) => {
      seen.push({ channelId, stillStored: rt.channels.get(channelId) !== null });
    });

    expect(() => service.delete(room.id)).toThrow(`DM channel not found: ${room.id}`);
    expect(() => service.delete('missing')).toThrow('DM channel not found: missing');
    expect(rt.channels.get(room.id)).not.toBeNull();
    service.delete(dm.id);
    expect(seen).toEqual([{ channelId: dm.id, stillStored: false }]);
  });
});

describe('close-listener failures route to the project logger, not console.warn (D3)', () => {
  let logger: StructuredLogger;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new StructuredLogger({ console: false, level: 'debug' });
    setLoggerAccessor(() => logger);
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearLoggerAccessor();
    consoleWarn.mockRestore();
  });

  it('DmChannelService: delete still resolves and the row is still gone when a closed listener throws', () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.dms.on('closed', () => { throw new Error('listener boom'); });

    expect(() => rt.dms.delete(dm.id)).not.toThrow();

    expect(rt.channels.get(dm.id)).toBeNull();
    const errorEntries = logger.getEntries({ level: 'error' })
      .filter((e) => e.component === 'dm-channel' && e.action === 'close-listener');
    expect(errorEntries).toHaveLength(1);
    expect((errorEntries[0]?.metadata as { channelId: string }).channelId).toBe(dm.id);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('ChatRoomService: archive still resolves and the row is still archived when a closed listener throws', () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const room = rt.createRoom('Room', ['bob']);
    rt.rooms.removeAllListeners('closed');
    rt.rooms.on('closed', () => { throw new Error('listener boom'); });

    expect(() => rt.rooms.archive(room.id)).not.toThrow();

    expect(rt.rooms.get(room.id)?.archivedAt).not.toBeNull();
    const errorEntries = logger.getEntries({ level: 'error' })
      .filter((e) => e.component === 'chat-room' && e.action === 'close-listener');
    expect(errorEntries).toHaveLength(1);
    expect((errorEntries[0]?.metadata as { channelId: string }).channelId).toBe(room.id);
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});

describe('DmAutoResponder.closeRoom cleans up the CLI coordinator even if the round interrupt throws (D3)', () => {
  it('still calls cliSessionCoordinator.closeRoom when roundRepository.interruptChannel throws', () => {
    const closeRoom = vi.fn().mockResolvedValue(undefined);
    const interruptChannel = vi.fn(() => { throw new Error('round boom'); });
    const responder = new DmAutoResponder({
      channelService: { listMembers: () => [] },
      messageService: { listByChannel: () => [], append: vi.fn(), appendWhisper: vi.fn() },
      providerLookup: { get: () => undefined },
      memberProfileLookup: { getProfile: () => { throw new Error('unused'); } },
      consensusPath: () => '/arena/consensus',
      cliSessionCoordinator: { respond: vi.fn(), closeRoom, shutdown: vi.fn() },
      roundRepository: {
        claim: () => true, finish: vi.fn(), interrupt: vi.fn(),
        interruptChannel, interruptRunning: vi.fn(),
      },
    } as unknown as DmAutoResponderDeps);

    expect(() => responder.closeRoom('dm-1')).not.toThrow();

    expect(interruptChannel).toHaveBeenCalledWith('dm-1');
    expect(closeRoom).toHaveBeenCalledWith('dm-1');
  });
});
