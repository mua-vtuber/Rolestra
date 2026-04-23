// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutonomyMode, needsConfirm } from '../use-autonomy-mode';
import type { AutonomyMode } from '../../../shared/project-types';

type StreamHandler = (payload: unknown) => void;
interface StreamMock {
  subscribers: Map<string, StreamHandler[]>;
  emit: (type: string, payload: unknown) => void;
}

function setupArena(
  invoke: ReturnType<typeof vi.fn>,
): StreamMock {
  const subscribers = new Map<string, StreamHandler[]>();
  const onStream = (type: string, cb: StreamHandler): (() => void) => {
    const list = subscribers.get(type) ?? [];
    list.push(cb);
    subscribers.set(type, list);
    return () => {
      const cur = subscribers.get(type) ?? [];
      subscribers.set(
        type,
        cur.filter((h) => h !== cb),
      );
    };
  };
  const emit = (type: string, payload: unknown): void => {
    (subscribers.get(type) ?? []).forEach((cb) => cb(payload));
  };
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream });
  return { subscribers, emit };
}

describe('useAutonomyMode — needsConfirm', () => {
  it('promotes manual → auto_toggle / queue require confirm', () => {
    expect(needsConfirm('manual', 'auto_toggle')).toBe(true);
    expect(needsConfirm('manual', 'queue')).toBe(true);
  });

  it('auto_toggle ↔ queue and downgrades skip confirm', () => {
    const pairs: Array<[AutonomyMode, AutonomyMode]> = [
      ['auto_toggle', 'queue'],
      ['queue', 'auto_toggle'],
      ['auto_toggle', 'manual'],
      ['queue', 'manual'],
    ];
    for (const [from, to] of pairs) {
      expect(needsConfirm(from, to)).toBe(false);
    }
  });
});

describe('useAutonomyMode hook', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('request(auto_toggle) from manual sets pendingTarget and does NOT invoke', () => {
    const invoke = vi.fn();
    setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'manual'),
    );

    act(() => {
      result.current.request('auto_toggle');
    });

    expect(result.current.pendingTarget).toBe('auto_toggle');
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('manual');
  });

  it('confirm() after request → invokes project:set-autonomy and clears pending', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'manual'),
    );

    act(() => {
      result.current.request('auto_toggle');
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(invoke).toHaveBeenCalledWith('project:set-autonomy', {
      id: 'p1',
      mode: 'auto_toggle',
    });
    expect(result.current.pendingTarget).toBeNull();
    expect(result.current.mode).toBe('auto_toggle');
  });

  it('request(manual) from auto_toggle skips dialog and invokes immediately', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'auto_toggle'),
    );

    act(() => {
      result.current.request('manual');
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:set-autonomy', {
        id: 'p1',
        mode: 'manual',
      });
    });
    expect(result.current.pendingTarget).toBeNull();
  });

  it('cancel() clears pendingTarget without calling invoke', () => {
    const invoke = vi.fn();
    setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'manual'),
    );

    act(() => {
      result.current.request('queue');
    });
    expect(result.current.pendingTarget).toBe('queue');

    act(() => {
      result.current.cancel();
    });

    expect(result.current.pendingTarget).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stream:autonomy-mode-changed for matching projectId updates mode', () => {
    const invoke = vi.fn();
    const { emit } = setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'manual'),
    );

    act(() => {
      emit('stream:autonomy-mode-changed', {
        projectId: 'p1',
        mode: 'queue',
        reason: 'circuit_breaker',
      });
    });

    expect(result.current.mode).toBe('queue');
  });

  it('stream:autonomy-mode-changed for different projectId is ignored', () => {
    const invoke = vi.fn();
    const { emit } = setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'manual'),
    );

    act(() => {
      emit('stream:autonomy-mode-changed', {
        projectId: 'other',
        mode: 'queue',
      });
    });

    expect(result.current.mode).toBe('manual');
  });

  it('invoke rejection rolls back optimistic mode and surfaces error', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('boom'));
    setupArena(invoke);

    const { result } = renderHook(() =>
      useAutonomyMode('p1', 'auto_toggle'),
    );

    await act(async () => {
      result.current.request('manual');
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });
    expect(result.current.mode).toBe('auto_toggle');
  });
});
