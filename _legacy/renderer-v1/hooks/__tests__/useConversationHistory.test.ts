/**
 * Tests for useConversationHistory hook.
 *
 * Validates load/delete/new conversation, history toggle, restore, and discard.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useConversationHistory } from '../useConversationHistory';
import { useChatStore } from '../../stores/chat-store';
import type { ConversationSummary } from '../../../shared/engine-types';

// ── Mock store ────────────────────────────────────────────────────────

const restoreMessagesMock = vi.fn();
const setConversationIdMock = vi.fn();
const newConversationMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

const mockedUseChatStore = vi.mocked(useChatStore);

describe('useConversationHistory', () => {
  let invoke: ReturnType<typeof vi.fn>;

  const makeConversationList = (): ConversationSummary[] => [
    {
      id: 'conv-1',
      title: 'Test Conversation',
      participantNames: ['Claude'],
      messageCount: 5,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
    restoreMessagesMock.mockReset();
    setConversationIdMock.mockReset();
    newConversationMock.mockReset().mockResolvedValue(undefined);

    mockedUseChatStore.mockImplementation((selector: unknown) => {
      const state = {
        restoreMessages: restoreMessagesMock,
        setConversationId: setConversationIdMock,
        newConversation: newConversationMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts with panels closed and empty lists', () => {
    const { result } = renderHook(() => useConversationHistory());
    expect(result.current.historyOpen).toBe(false);
    expect(result.current.historyList).toEqual([]);
    expect(result.current.conversationListOpen).toBe(false);
    expect(result.current.conversationList).toEqual([]);
  });

  // ── History toggle ─────────────────────────────────────────────

  it('handleHistoryToggle opens history and fetches data', async () => {
    invoke
      .mockResolvedValueOnce({ conversations: [] }) // recovery:list
      .mockResolvedValueOnce({ conversations: makeConversationList() }); // conversation:list
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { result.current.handleHistoryToggle(); });

    expect(result.current.historyOpen).toBe(true);
    expect(invoke).toHaveBeenCalledWith('recovery:list', undefined);
    expect(invoke).toHaveBeenCalledWith('conversation:list', { limit: 50, offset: 0 });
  });

  it('handleHistoryToggle closes when already open', () => {
    const { result } = renderHook(() => useConversationHistory());

    // Open
    act(() => { result.current.handleHistoryToggle(); });
    expect(result.current.historyOpen).toBe(true);

    // Close
    act(() => { result.current.handleHistoryToggle(); });
    expect(result.current.historyOpen).toBe(false);
  });

  // ── History restore ────────────────────────────────────────────

  it('handleHistoryRestore calls recovery:restore and restores messages', async () => {
    const msgs = [{ id: '1', role: 'user', content: 'hi', timestamp: 1 }];
    invoke.mockResolvedValue({
      success: true,
      snapshot: { messagesJson: JSON.stringify(msgs) },
    });
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { await result.current.handleHistoryRestore('conv-1'); });

    expect(invoke).toHaveBeenCalledWith('recovery:restore', { conversationId: 'conv-1' });
    expect(restoreMessagesMock).toHaveBeenCalledWith(msgs);
    expect(result.current.historyOpen).toBe(false);
  });

  it('handleHistoryRestore closes history even when messagesJson is absent', async () => {
    invoke.mockResolvedValue({ success: true, snapshot: {} });
    const { result } = renderHook(() => useConversationHistory());

    // Open history first
    act(() => { result.current.handleHistoryToggle(); });

    await act(async () => { await result.current.handleHistoryRestore('conv-1'); });
    expect(result.current.historyOpen).toBe(false);
  });

  // ── History discard ────────────────────────────────────────────

  it('handleHistoryDiscard calls recovery:discard and refreshes list', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // recovery:discard
      .mockResolvedValueOnce({ conversations: [] }); // recovery:list (refresh)
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { await result.current.handleHistoryDiscard('conv-1'); });

    expect(invoke).toHaveBeenCalledWith('recovery:discard', { conversationId: 'conv-1' });
    expect(invoke).toHaveBeenCalledWith('recovery:list', undefined);
  });

  // ── Conversation list toggle ───────────────────────────────────

  it('handleConversationListToggle opens list and fetches conversations', async () => {
    invoke.mockResolvedValue({ conversations: makeConversationList() });
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { result.current.handleConversationListToggle(); });

    expect(result.current.conversationListOpen).toBe(true);
    expect(invoke).toHaveBeenCalledWith('conversation:list', { limit: 50, offset: 0 });
  });

  // ── Load conversation ──────────────────────────────────────────

  it('handleLoadConversation loads messages and sets conversation ID', async () => {
    invoke.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'hello',
          participantName: 'Claude',
          createdAt: '2024-01-01T00:00:00Z',
          responseTimeMs: 500,
          tokenCount: 10,
        },
      ],
    });
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { await result.current.handleLoadConversation('conv-1'); });

    expect(invoke).toHaveBeenCalledWith('conversation:load', { conversationId: 'conv-1' });
    expect(restoreMessagesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'msg-1',
        role: 'assistant',
        content: 'hello',
        speakerName: 'Claude',
        responseTimeMs: 500,
        tokenCount: 10,
      }),
    ]);
    expect(setConversationIdMock).toHaveBeenCalledWith('conv-1');
    expect(result.current.conversationListOpen).toBe(false);
  });

  // ── Delete conversation ────────────────────────────────────────

  it('handleDeleteConversation calls conversation:delete and refreshes', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // conversation:delete
      .mockResolvedValueOnce({ conversations: [] }); // conversation:list (refresh)
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => { await result.current.handleDeleteConversation('conv-1'); });

    expect(invoke).toHaveBeenCalledWith('conversation:delete', { conversationId: 'conv-1' });
  });

  // ── New conversation ───────────────────────────────────────────

  it('handleNewConversation calls newConversation and closes list', () => {
    const { result } = renderHook(() => useConversationHistory());

    // Open conversation list
    act(() => { result.current.handleConversationListToggle(); });

    act(() => { result.current.handleNewConversation(); });

    expect(newConversationMock).toHaveBeenCalled();
    expect(result.current.conversationListOpen).toBe(false);
  });
});
