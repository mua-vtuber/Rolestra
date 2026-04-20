// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '../invoke';

describe('invoke — typed IPC wrapper', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards channel and data to window.arena.invoke and returns its response', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ pong: true, timestamp: 123 });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const response = await invoke('app:ping', undefined);

    expect(bridgeInvoke).toHaveBeenCalledTimes(1);
    expect(bridgeInvoke).toHaveBeenCalledWith('app:ping', undefined);
    expect(response).toEqual({ pong: true, timestamp: 123 });
  });

  it('forwards the exact data payload (reference equality) for channels with input', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ projects: [] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const payload = { includeArchived: false };
    await invoke('project:list', payload);

    const [channelArg, dataArg] = bridgeInvoke.mock.calls[0] ?? [];
    expect(channelArg).toBe('project:list');
    expect(dataArg).toBe(payload);
  });

  it('throws "arena bridge not available" when window.arena is undefined', async () => {
    vi.stubGlobal('arena', undefined);

    await expect(invoke('app:ping', undefined)).rejects.toThrow(
      'arena bridge not available',
    );
  });

  it('re-throws the original rejection reason unchanged (no wrapping)', async () => {
    const original = new Error('main-side failure');
    const bridgeInvoke = vi.fn().mockRejectedValue(original);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    await expect(invoke('app:ping', undefined)).rejects.toBe(original);
  });
});
