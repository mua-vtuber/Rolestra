/**
 * Tests for useStreamEvent hook.
 *
 * Validates event subscription lifecycle via window.arena.on.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installArenaMock, type OnMock } from './setup';

// DO NOT import from setup's auto-mock — we need the REAL useStreamEvent
// But setup.ts auto-mocks useErrorDialog and react-i18next as side effects,
// which is fine. We just need to NOT mock useStream.

// We need to mock ONLY the arena API, not the hook itself.

describe('useStreamEvent', () => {
  let on: OnMock;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribe = vi.fn();
    const mocks = installArenaMock();
    on = mocks.on;
    on.mockReturnValue(unsubscribe);
  });

  it('subscribes to the given event on mount', async () => {
    // Dynamic import to avoid hoisting issues with mocks
    const { useStreamEvent } = await import('../useStream');

    const callback = vi.fn();
    renderHook(() => useStreamEvent('stream:token', callback));

    expect(on).toHaveBeenCalledWith('stream:token', expect.any(Function));
  });

  it('calls unsubscribe on unmount', async () => {
    const { useStreamEvent } = await import('../useStream');

    const callback = vi.fn();
    const { unmount } = renderHook(() => useStreamEvent('stream:token', callback));

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('invokes the latest callback when event fires', async () => {
    const { useStreamEvent } = await import('../useStream');

    const callback = vi.fn();
    renderHook(() => useStreamEvent('stream:token', callback));

    // Get the handler that was registered
    const registeredHandler = on.mock.calls[0][1];
    const mockData = { conversationId: 'c1', messageId: 'm1', participantId: 'p1', token: 'hello', sequence: 0 };
    registeredHandler(mockData);

    expect(callback).toHaveBeenCalledWith(mockData);
  });
});
