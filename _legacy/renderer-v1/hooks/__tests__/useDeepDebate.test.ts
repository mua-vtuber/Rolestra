/**
 * Tests for useDeepDebate hook.
 *
 * Validates dialog open/close state and IPC dispatch for deep debate actions.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useDeepDebate } from '../useDeepDebate';
import type { StreamDeepDebateEvent, StreamConsensusDocumentEvent } from '../../../shared/stream-types';

describe('useDeepDebate', () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts with dialog closed and null state', () => {
    const { result } = renderHook(() => useDeepDebate());
    expect(result.current.deepDebateDialogOpen).toBe(false);
    expect(result.current.deepDebate).toBeNull();
    expect(result.current.consensusDocument).toBeNull();
  });

  // ── Dialog open/close ──────────────────────────────────────────

  it('handleDeepDebate opens the dialog', () => {
    const { result } = renderHook(() => useDeepDebate());

    act(() => { result.current.handleDeepDebate(); });

    expect(result.current.deepDebateDialogOpen).toBe(true);
  });

  it('handleDeepDebateCancel closes the dialog', () => {
    const { result } = renderHook(() => useDeepDebate());

    act(() => { result.current.handleDeepDebate(); });
    expect(result.current.deepDebateDialogOpen).toBe(true);

    act(() => { result.current.handleDeepDebateCancel(); });
    expect(result.current.deepDebateDialogOpen).toBe(false);
  });

  // ── handleDeepDebateStart ──────────────────────────────────────

  it('handleDeepDebateStart closes dialog and invokes chat:deep-debate', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeepDebate());

    act(() => { result.current.handleDeepDebate(); });
    act(() => { result.current.handleDeepDebateStart('ai-claude'); });

    expect(result.current.deepDebateDialogOpen).toBe(false);
    expect(invoke).toHaveBeenCalledWith('chat:deep-debate', { facilitatorId: 'ai-claude' });
  });

  // ── State setters ──────────────────────────────────────────────

  it('setDeepDebate updates deep debate event', () => {
    const { result } = renderHook(() => useDeepDebate());
    const event: StreamDeepDebateEvent = {
      conversationId: 'conv-1',
      active: true,
      turnsUsed: 3,
      turnBudget: 30,
      turnsRemaining: 27,
    };

    act(() => { result.current.setDeepDebate(event); });

    expect(result.current.deepDebate).toEqual(event);
  });

  it('setDeepDebate can clear to null', () => {
    const { result } = renderHook(() => useDeepDebate());
    const event: StreamDeepDebateEvent = {
      conversationId: 'conv-1',
      active: true,
      turnsUsed: 1,
      turnBudget: 30,
      turnsRemaining: 29,
    };

    act(() => { result.current.setDeepDebate(event); });
    act(() => { result.current.setDeepDebate(null); });

    expect(result.current.deepDebate).toBeNull();
  });

  it('setConsensusDocument updates consensus document', () => {
    const { result } = renderHook(() => useDeepDebate());
    const doc: StreamConsensusDocumentEvent = {
      conversationId: 'conv-1',
      document: '# Final Agreement',
      facilitatorId: 'ai-1',
      facilitatorName: 'Claude',
    };

    act(() => { result.current.setConsensusDocument(doc); });

    expect(result.current.consensusDocument).toEqual(doc);
  });

  it('setConsensusDocument can clear to null', () => {
    const { result } = renderHook(() => useDeepDebate());
    const doc: StreamConsensusDocumentEvent = {
      conversationId: 'conv-1',
      document: '# Agreement',
      facilitatorId: 'ai-1',
      facilitatorName: 'Claude',
    };

    act(() => { result.current.setConsensusDocument(doc); });
    act(() => { result.current.setConsensusDocument(null); });

    expect(result.current.consensusDocument).toBeNull();
  });
});
