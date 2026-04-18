/**
 * Tests for useStreamMessages hook.
 *
 * Validates stream event subscriptions are registered via window.arena.on.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useStreamMessages } from '../useStreamMessages';
import { useChatStore } from '../../stores/chat-store';
import { useProviderStore } from '../../stores/provider-store';

// ── Mock stores ─────────────────────────────────────────────────────────

vi.mock('../../stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

vi.mock('../../stores/provider-store', () => ({
  useProviderStore: vi.fn(),
}));

// ── Mock useStreamEvent to capture registrations ────────────────────────

const registeredHandlers = new Map<string, (...args: unknown[]) => void>();

vi.mock('../useStream', () => ({
  useStreamEvent: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    registeredHandlers.set(event, handler);
  }),
}));

const mockedUseChatStore = vi.mocked(useChatStore);
const mockedUseProviderStore = vi.mocked(useProviderStore);

describe('useStreamMessages', () => {
  let _on: ReturnType<typeof vi.fn>;

  const addMessageMock = vi.fn();
  const appendTokenMock = vi.fn();
  const finalizeMessageMock = vi.fn();
  const setConversationStateMock = vi.fn();
  const pauseMock = vi.fn().mockResolvedValue(undefined);
  const addTokenUsageMock = vi.fn();

  const setTurnWaitingMock = vi.fn();
  const setConsensusMock = vi.fn();
  const setPendingDiffsMock = vi.fn();
  const setPendingPermissionMock = vi.fn();
  const setFailureReportMock = vi.fn();
  const setDeepDebateMock = vi.fn();
  const setConsensusDocumentMock = vi.fn();

  function makeParams() {
    return {
      setTurnWaiting: setTurnWaitingMock,
      setConsensus: setConsensusMock,
      pendingDiffs: null as { operationId: string; diffs: never[] } | null,
      setPendingDiffs: setPendingDiffsMock,
      setPendingPermission: setPendingPermissionMock,
      setFailureReport: setFailureReportMock,
      setDeepDebate: setDeepDebateMock,
      setConsensusDocument: setConsensusDocumentMock,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    ({ on: _on } = installArenaMock());

    mockedUseChatStore.mockImplementation((selector: unknown) => {
      const state = {
        addMessage: addMessageMock,
        appendToken: appendTokenMock,
        finalizeMessage: finalizeMessageMock,
        setConversationState: setConversationStateMock,
        sending: false,
        paused: false,
        pause: pauseMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });

    mockedUseProviderStore.mockImplementation((selector: unknown) => {
      const state = {
        addTokenUsage: addTokenUsageMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });
  });

  it('registers stream event handlers via useStreamEvent', () => {
    renderHook(() => useStreamMessages(makeParams()));

    // Verify all expected stream events are registered
    expect(registeredHandlers.has('stream:message-start')).toBe(true);
    expect(registeredHandlers.has('stream:token')).toBe(true);
    expect(registeredHandlers.has('stream:message-done')).toBe(true);
    expect(registeredHandlers.has('stream:state')).toBe(true);
    expect(registeredHandlers.has('stream:error')).toBe(true);
    expect(registeredHandlers.has('stream:turn-wait')).toBe(true);
    expect(registeredHandlers.has('stream:consensus-update')).toBe(true);
    expect(registeredHandlers.has('stream:execution-pending')).toBe(true);
    expect(registeredHandlers.has('stream:permission-pending')).toBe(true);
    expect(registeredHandlers.has('stream:failure-report')).toBe(true);
    expect(registeredHandlers.has('stream:deep-debate')).toBe(true);
    expect(registeredHandlers.has('stream:consensus-document')).toBe(true);
  });

  it('stream:token handler calls appendToken on store', () => {
    renderHook(() => useStreamMessages(makeParams()));

    const tokenHandler = registeredHandlers.get('stream:token');
    tokenHandler?.({ messageId: 'msg-1', token: 'hello' });

    expect(appendTokenMock).toHaveBeenCalledWith('msg-1', 'hello');
  });

  it('stream:turn-wait handler sets turnWaiting to true', () => {
    renderHook(() => useStreamMessages(makeParams()));

    const turnWaitHandler = registeredHandlers.get('stream:turn-wait');
    turnWaitHandler?.();

    expect(setTurnWaitingMock).toHaveBeenCalledWith(true);
  });

  it('stream:consensus-update handler calls setConsensus', () => {
    renderHook(() => useStreamMessages(makeParams()));

    const consensusData = { phase: 'VOTING', round: 1 };
    const consensusHandler = registeredHandlers.get('stream:consensus-update');
    consensusHandler?.({ consensus: consensusData });

    expect(setConsensusMock).toHaveBeenCalledWith(consensusData);
  });

  it('stream:consensus-document handler calls setConsensusDocument', () => {
    renderHook(() => useStreamMessages(makeParams()));

    const doc = { conversationId: 'conv-1', document: '# Doc', facilitatorId: 'ai-1', facilitatorName: 'Claude' };
    const docHandler = registeredHandlers.get('stream:consensus-document');
    docHandler?.(doc);

    expect(setConsensusDocumentMock).toHaveBeenCalledWith(doc);
  });

  it('does not throw when rendered with empty params', () => {
    expect(() => {
      renderHook(() => useStreamMessages(makeParams()));
    }).not.toThrow();
  });
});
