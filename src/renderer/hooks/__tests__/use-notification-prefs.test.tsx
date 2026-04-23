// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationPrefs } from '../use-notification-prefs';
import type { NotificationPrefs } from '../../../shared/notification-types';

function makePrefs(overrides: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return {
    new_message: { enabled: true, soundEnabled: true },
    approval_pending: { enabled: true, soundEnabled: true },
    work_done: { enabled: true, soundEnabled: true },
    error: { enabled: true, soundEnabled: true },
    queue_progress: { enabled: true, soundEnabled: true },
    meeting_state: { enabled: true, soundEnabled: true },
    ...overrides,
  };
}

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): {
  emit: (type: string, payload: unknown) => void;
} {
  const subs = new Map<string, ((p: unknown) => void)[]>();
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: (type: string, cb: (p: unknown) => void) => {
      const list = subs.get(type) ?? [];
      list.push(cb);
      subs.set(type, list);
      return () => {
        subs.set(type, (subs.get(type) ?? []).filter((h) => h !== cb));
      };
    },
  });
  return {
    emit: (type, payload) =>
      (subs.get(type) ?? []).forEach((cb) => cb(payload)),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('useNotificationPrefs — mount / fetch / stream', () => {
  it('mounts → calls notification:get-prefs once and populates prefs', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prefs).not.toBeNull();
    expect(result.current.prefs?.new_message.enabled).toBe(true);
    expect(
      invoke.mock.calls.filter((c) => c[0] === 'notification:get-prefs'),
    ).toHaveLength(1);
  });

  it('surfaces fetch errors via error state', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => {
        throw new Error('db down');
      },
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prefs).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('db down');
  });

  it('stream:notification-prefs-changed replaces the full prefs map', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    const { emit } = setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const updated = makePrefs({
      new_message: { enabled: false, soundEnabled: false },
    });
    act(() => {
      emit('stream:notification-prefs-changed', { prefs: updated });
    });

    expect(result.current.prefs?.new_message.enabled).toBe(false);
    expect(result.current.prefs?.new_message.soundEnabled).toBe(false);
  });
});

describe('useNotificationPrefs — mutations', () => {
  it('setKind invokes notification:update-prefs with nested patch', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:update-prefs': (data) => {
        const patch = (data as { patch: Record<string, unknown> }).patch;
        const next = makePrefs();
        for (const [kind, entry] of Object.entries(patch)) {
          const e = entry as { enabled?: boolean; soundEnabled?: boolean };
          next[kind as keyof typeof next] = {
            enabled: e.enabled ?? next[kind as keyof typeof next].enabled,
            soundEnabled:
              e.soundEnabled ?? next[kind as keyof typeof next].soundEnabled,
          };
        }
        return { prefs: next };
      },
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setKind('new_message', { enabled: false });
    });

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:update-prefs',
    );
    expect(updateCall?.[1]).toEqual({
      patch: { new_message: { enabled: false } },
    });
    expect(result.current.prefs?.new_message.enabled).toBe(false);
    // Unrelated kinds unchanged.
    expect(result.current.prefs?.approval_pending.enabled).toBe(true);
  });

  it('setKind forwards soundEnabled independently of enabled', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:update-prefs': () => ({
        prefs: makePrefs({
          work_done: { enabled: true, soundEnabled: false },
        }),
      }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setKind('work_done', { soundEnabled: false });
    });

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:update-prefs',
    );
    expect(updateCall?.[1]).toEqual({
      patch: { work_done: { soundEnabled: false } },
    });
  });

  it('test invokes notification:test with the given kind', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:test': () => ({ success: true }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test('error');
    });

    const testCall = invoke.mock.calls.find((c) => c[0] === 'notification:test');
    expect(testCall?.[1]).toEqual({ kind: 'error' });
  });

  it('setKind surfaces invoke errors via error state and rethrows', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:update-prefs': () => {
        throw new Error('boom');
      },
    });
    setupArena(invoke);

    const { result } = renderHook(() => useNotificationPrefs());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.setKind('error', { enabled: false });
      } catch (reason) {
        caught = reason;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
  });
});
