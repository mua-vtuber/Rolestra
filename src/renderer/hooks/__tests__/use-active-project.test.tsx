// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveProject } from '../use-active-project';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  useActiveProjectStore,
} from '../../stores/active-project-store';

function resetStore(): void {
  useActiveProjectStore.setState({ activeProjectId: null });
  localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
}

describe('useActiveProject', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetStore();
  });

  it('exposes the current activeProjectId from the store', () => {
    useActiveProjectStore.setState({ activeProjectId: 'p-preset' });
    const { result } = renderHook(() => useActiveProject());
    expect(result.current.activeProjectId).toBe('p-preset');
  });

  it('setActive(id) calls project:open THEN updates the store', async () => {
    const callOrder: string[] = [];
    const invoke = vi.fn(async (channel: string) => {
      callOrder.push(channel);
      // Capture store state AT the moment the IPC fires — must still be null.
      if (channel === 'project:open') {
        if (useActiveProjectStore.getState().activeProjectId !== null) {
          throw new Error('store was updated before IPC resolved');
        }
        return { success: true };
      }
      return undefined;
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useActiveProject());

    await act(async () => {
      await result.current.setActive('p-42');
    });

    expect(invoke).toHaveBeenCalledWith('project:open', { id: 'p-42' });
    expect(callOrder).toEqual(['project:open']);
    expect(useActiveProjectStore.getState().activeProjectId).toBe('p-42');

    await waitFor(() => {
      expect(result.current.activeProjectId).toBe('p-42');
    });
  });

  it('when project:open rejects, the store is NOT updated and the error propagates', async () => {
    const failure = new Error('folder missing');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    useActiveProjectStore.setState({ activeProjectId: 'p-prev' });
    const { result } = renderHook(() => useActiveProject());

    await act(async () => {
      await expect(result.current.setActive('p-bad')).rejects.toBe(failure);
    });

    // Store must be unchanged.
    expect(useActiveProjectStore.getState().activeProjectId).toBe('p-prev');
    expect(result.current.activeProjectId).toBe('p-prev');
  });

  it('clear() nulls the activeProjectId without any IPC call', () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    useActiveProjectStore.setState({ activeProjectId: 'p-set' });
    const { result } = renderHook(() => useActiveProject());

    act(() => {
      result.current.clear();
    });

    expect(useActiveProjectStore.getState().activeProjectId).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
