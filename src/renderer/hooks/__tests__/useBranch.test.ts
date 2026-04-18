/**
 * Tests for useBranch hook.
 *
 * Validates switch/fork delegation to store actions.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import './setup';
import { useBranch } from '../useBranch';
import { useChatStore } from '../../stores/chat-store';

// ── Mock store ────────────────────────────────────────────────────────

const switchBranchMock = vi.fn().mockResolvedValue(undefined);
const forkFromMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

const mockedUseChatStore = vi.mocked(useChatStore);

describe('useBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchBranchMock.mockResolvedValue(undefined);
    forkFromMessageMock.mockResolvedValue(undefined);

    mockedUseChatStore.mockImplementation((selector: unknown) => {
      const state = {
        currentBranchId: 'main',
        branches: [],
        switchBranch: switchBranchMock,
        forkFromMessage: forkFromMessageMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });
  });

  // ── handleSwitchBranch ─────────────────────────────────────────

  it('handleSwitchBranch delegates to switchBranch', () => {
    const { result } = renderHook(() => useBranch());

    act(() => { result.current.handleSwitchBranch('branch-2'); });

    expect(switchBranchMock).toHaveBeenCalledWith('branch-2');
  });

  it('handleSwitchBranch can be called with different branch IDs', () => {
    const { result } = renderHook(() => useBranch());

    act(() => { result.current.handleSwitchBranch('main'); });
    act(() => { result.current.handleSwitchBranch('feature-1'); });
    act(() => { result.current.handleSwitchBranch('branch-xyz'); });

    expect(switchBranchMock).toHaveBeenCalledTimes(3);
    expect(switchBranchMock).toHaveBeenNthCalledWith(1, 'main');
    expect(switchBranchMock).toHaveBeenNthCalledWith(2, 'feature-1');
    expect(switchBranchMock).toHaveBeenNthCalledWith(3, 'branch-xyz');
  });

  // ── handleFork ─────────────────────────────────────────────────

  it('handleFork delegates to forkFromMessage', () => {
    const { result } = renderHook(() => useBranch());

    act(() => { result.current.handleFork('msg-42'); });

    expect(forkFromMessageMock).toHaveBeenCalledWith('msg-42');
  });

  it('handleFork can be called with different message IDs', () => {
    const { result } = renderHook(() => useBranch());

    act(() => { result.current.handleFork('msg-1'); });
    act(() => { result.current.handleFork('msg-2'); });

    expect(forkFromMessageMock).toHaveBeenCalledTimes(2);
    expect(forkFromMessageMock).toHaveBeenNthCalledWith(1, 'msg-1');
    expect(forkFromMessageMock).toHaveBeenNthCalledWith(2, 'msg-2');
  });

  // ── Independence ───────────────────────────────────────────────

  it('switch and fork do not interfere with each other', () => {
    const { result } = renderHook(() => useBranch());

    act(() => { result.current.handleSwitchBranch('branch-1'); });
    act(() => { result.current.handleFork('msg-1'); });
    act(() => { result.current.handleSwitchBranch('branch-2'); });

    expect(switchBranchMock).toHaveBeenCalledTimes(2);
    expect(forkFromMessageMock).toHaveBeenCalledTimes(1);
  });
});
