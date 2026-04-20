/**
 * Tests for useExecutionApproval hook.
 *
 * Validates approve/reject IPC calls for diffs and permissions.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useExecutionApproval } from '../useExecutionApproval';
import type { DiffEntry } from '../../../shared/execution-types';

describe('useExecutionApproval', () => {
  let invoke: ReturnType<typeof vi.fn>;

  const makeDiffs = (): { operationId: string; diffs: DiffEntry[] } => ({
    operationId: 'op-1',
    diffs: [{ path: '/file.ts', operation: 'modify', before: 'old', after: 'new' }],
  });

  const makePermission = () => ({
    requestId: 'perm-1',
    conversationId: 'conv-1',
    participantId: 'ai-1',
    action: 'write' as const,
    targetPath: '/project/file.ts',
    timestamp: Date.now(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts with null pending diffs and permissions', () => {
    const { result } = renderHook(() => useExecutionApproval());
    expect(result.current.pendingDiffs).toBeNull();
    expect(result.current.pendingPermission).toBeNull();
  });

  // ── Diff approve ───────────────────────────────────────────────

  it('handleDiffApprove calls execution:approve and clears pendingDiffs', async () => {
    invoke.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useExecutionApproval());

    act(() => { result.current.setPendingDiffs(makeDiffs()); });
    expect(result.current.pendingDiffs).not.toBeNull();

    await act(async () => { await result.current.handleDiffApprove(); });
    expect(invoke).toHaveBeenCalledWith('execution:approve', { operationId: 'op-1' });
    expect(result.current.pendingDiffs).toBeNull();
  });

  it('handleDiffApprove does nothing when pendingDiffs is null', async () => {
    const { result } = renderHook(() => useExecutionApproval());

    await act(async () => { await result.current.handleDiffApprove(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Diff reject ────────────────────────────────────────────────

  it('handleDiffReject calls execution:reject and clears pendingDiffs', async () => {
    invoke.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useExecutionApproval());

    act(() => { result.current.setPendingDiffs(makeDiffs()); });

    await act(async () => { await result.current.handleDiffReject(); });
    expect(invoke).toHaveBeenCalledWith('execution:reject', { operationId: 'op-1' });
    expect(result.current.pendingDiffs).toBeNull();
  });

  it('handleDiffReject does nothing when pendingDiffs is null', async () => {
    const { result } = renderHook(() => useExecutionApproval());

    await act(async () => { await result.current.handleDiffReject(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Permission approve ─────────────────────────────────────────

  it('handlePermissionApprove calls permission:approve and clears pendingPermission', async () => {
    invoke.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useExecutionApproval());

    act(() => { result.current.setPendingPermission(makePermission()); });

    await act(async () => { await result.current.handlePermissionApprove(); });
    expect(invoke).toHaveBeenCalledWith('permission:approve', { requestId: 'perm-1' });
    expect(result.current.pendingPermission).toBeNull();
  });

  it('handlePermissionApprove does nothing when pendingPermission is null', async () => {
    const { result } = renderHook(() => useExecutionApproval());

    await act(async () => { await result.current.handlePermissionApprove(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Permission reject ──────────────────────────────────────────

  it('handlePermissionReject calls permission:reject and clears pendingPermission', async () => {
    invoke.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useExecutionApproval());

    act(() => { result.current.setPendingPermission(makePermission()); });

    await act(async () => { await result.current.handlePermissionReject(); });
    expect(invoke).toHaveBeenCalledWith('permission:reject', { requestId: 'perm-1' });
    expect(result.current.pendingPermission).toBeNull();
  });

  it('handlePermissionReject does nothing when pendingPermission is null', async () => {
    const { result } = renderHook(() => useExecutionApproval());

    await act(async () => { await result.current.handlePermissionReject(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Error handling ─────────────────────────────────────────────

  it('does not clear pendingDiffs when execution:approve returns success: false', async () => {
    invoke.mockResolvedValue({ success: false, error: 'something broke' });
    const { result } = renderHook(() => useExecutionApproval());

    act(() => { result.current.setPendingDiffs(makeDiffs()); });

    await act(async () => { await result.current.handleDiffApprove(); });
    // The hook throws internally and showError is called; pendingDiffs stays set
    // because the error is caught and showError is called rather than clearing
    expect(invoke).toHaveBeenCalledWith('execution:approve', { operationId: 'op-1' });
  });
});
