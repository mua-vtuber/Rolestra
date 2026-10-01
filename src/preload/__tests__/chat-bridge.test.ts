import { describe, expect, it, vi } from 'vitest';
import { LIVE_IPC_CHANNELS } from '../../shared/ipc-types';

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(async () => ({ pong: true, timestamp: 1 })),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => {
    bridge.exposed.set(name, value);
  } },
  ipcRenderer: {
    invoke: bridge.invoke,
    on: bridge.on,
    removeListener: bridge.removeListener,
  },
}));

describe('preload chat IPC boundary', () => {
  it('exposes only live invoke channels and removes work dev hooks', async () => {
    await import('../index');
    const arena = bridge.exposed.get('arena') as {
      invoke: (channel: string, data: unknown) => Promise<unknown>;
    };
    expect(arena).toBeDefined();
    expect(bridge.exposed.has('__rolestraDevHooks')).toBe(false);
    expect(LIVE_IPC_CHANNELS).toContain('dm:create');
    await expect(arena.invoke('app:ping', undefined)).resolves.toEqual({ pong: true, timestamp: 1 });
    expect(() => arena.invoke('project:create', {})).toThrow('IPC channel unavailable');
    expect(() => arena.invoke('dev:trip-circuit-breaker', {})).toThrow('IPC channel unavailable');
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects retired stream subscriptions and retains live unsubscribe behavior', async () => {
    await import('../index');
    const arena = bridge.exposed.get('arena') as {
      onStream: (type: string, callback: (payload: unknown) => void) => () => void;
    };
    expect(() => arena.onStream('stream:queue-updated', () => undefined))
      .toThrow('Stream event unavailable');
    expect(() => arena.onStream('stream:unknown', () => undefined))
      .toThrow('Stream event unavailable');
    const callback = vi.fn();
    const off = arena.onStream('stream:channel-message', callback);
    const listener = bridge.on.mock.calls.at(-1)?.[1] as (event: unknown, payload: unknown) => void;
    listener({}, { message: { id: 'm1' } });
    expect(callback).toHaveBeenCalledWith({ message: { id: 'm1' } });
    off();
    expect(bridge.removeListener).toHaveBeenCalledWith('stream:channel-message', listener);
    const activity = vi.fn();
    arena.onStream('stream:chat-activity', activity);
    const activityListener = bridge.on.mock.calls.at(-1)?.[1] as (event: unknown, payload: unknown) => void;
    activityListener({}, { channelId: 'room', providerId: 'ai-1', phase: 'writing', kind: 'turn' });
    expect(activity).toHaveBeenCalledWith({ channelId: 'room', providerId: 'ai-1', phase: 'writing', kind: 'turn' });
  });

  it('allows the pass-turn invoke channel (spec 2026-10-01 F1)', async () => {
    await import('../index');
    const arena = bridge.exposed.get('arena') as {
      invoke: (channel: string, data: unknown) => Promise<unknown>;
    };
    expect(LIVE_IPC_CHANNELS).toContain('chat:pass-turn');
    await arena.invoke('chat:pass-turn', { channelId: 'room' });
    expect(bridge.invoke).toHaveBeenLastCalledWith('chat:pass-turn', expect.objectContaining({ data: { channelId: 'room' } }));
  });
});
