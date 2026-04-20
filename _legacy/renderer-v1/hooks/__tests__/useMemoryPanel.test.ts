/**
 * Tests for useMemoryPanel hook.
 *
 * Validates search IPC, toggle, and pin behavior.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useMemoryPanel } from '../useMemoryPanel';
import type { MemorySearchResult } from '../../../shared/memory-types';

describe('useMemoryPanel', () => {
  let invoke: ReturnType<typeof vi.fn>;

  const makeSearchResults = (): MemorySearchResult[] => [
    {
      id: 'node-1',
      content: 'test knowledge',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.8,
      score: 0.95,
      pinned: false,
      createdAt: '2024-01-01',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts closed with empty query and results', () => {
    const { result } = renderHook(() => useMemoryPanel());
    expect(result.current.memoryOpen).toBe(false);
    expect(result.current.memoryQuery).toBe('');
    expect(result.current.memoryTopic).toBe('');
    expect(result.current.memoryResults).toEqual([]);
  });

  // ── Toggle ─────────────────────────────────────────────────────

  it('handleToggleMemory toggles open state', () => {
    const { result } = renderHook(() => useMemoryPanel());

    act(() => { result.current.handleToggleMemory(); });
    expect(result.current.memoryOpen).toBe(true);

    act(() => { result.current.handleToggleMemory(); });
    expect(result.current.memoryOpen).toBe(false);
  });

  // ── Search ─────────────────────────────────────────────────────

  it('handleMemorySearch calls memory:search IPC and stores results', async () => {
    const searchResults = makeSearchResults();
    invoke.mockResolvedValue({ results: searchResults });
    const { result } = renderHook(() => useMemoryPanel());

    act(() => { result.current.setMemoryQuery('test'); });

    await act(async () => { await result.current.handleMemorySearch(); });

    expect(invoke).toHaveBeenCalledWith('memory:search', {
      query: 'test',
      topic: undefined,
      limit: 20,
    });
    expect(result.current.memoryResults).toEqual(searchResults);
  });

  it('handleMemorySearch passes topic when set', async () => {
    invoke.mockResolvedValue({ results: [] });
    const { result } = renderHook(() => useMemoryPanel());

    act(() => {
      result.current.setMemoryQuery('decisions');
      result.current.setMemoryTopic('decisions');
    });

    await act(async () => { await result.current.handleMemorySearch(); });

    expect(invoke).toHaveBeenCalledWith('memory:search', {
      query: 'decisions',
      topic: 'decisions',
      limit: 20,
    });
  });

  it('handleMemorySearch does nothing when query is empty', async () => {
    const { result } = renderHook(() => useMemoryPanel());

    await act(async () => { await result.current.handleMemorySearch(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('handleMemorySearch does nothing when query is whitespace only', async () => {
    const { result } = renderHook(() => useMemoryPanel());

    act(() => { result.current.setMemoryQuery('   '); });

    await act(async () => { await result.current.handleMemorySearch(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Pin ────────────────────────────────────────────────────────

  it('handlePinMessage calls memory:pin IPC', async () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMemoryPanel());

    await act(async () => { await result.current.handlePinMessage('msg-1', 'technical'); });

    expect(invoke).toHaveBeenCalledWith('memory:pin', {
      messageId: 'msg-1',
      topic: 'technical',
    });
  });

  // ── State setters ──────────────────────────────────────────────

  it('setMemoryQuery updates query', () => {
    const { result } = renderHook(() => useMemoryPanel());
    act(() => { result.current.setMemoryQuery('new query'); });
    expect(result.current.memoryQuery).toBe('new query');
  });

  it('setMemoryTopic updates topic', () => {
    const { result } = renderHook(() => useMemoryPanel());
    act(() => { result.current.setMemoryTopic('preferences'); });
    expect(result.current.memoryTopic).toBe('preferences');
  });
});
