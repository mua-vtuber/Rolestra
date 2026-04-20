/**
 * Tests for useMessageSearch hook.
 *
 * Validates toggle open/close, filter by query, clear on close,
 * and Ctrl+F / Escape keyboard shortcuts.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import './setup';
import { useMessageSearch } from '../useMessageSearch';
import type { ChatMessage } from '../../stores/chat-store';

const makeMessages = (): ChatMessage[] => [
  { id: '1', role: 'user', content: 'Hello world', timestamp: 1 },
  { id: '2', role: 'assistant', content: 'Hi there', timestamp: 2 },
  { id: '3', role: 'user', content: 'World domination plan', timestamp: 3 },
];

describe('useMessageSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts closed with empty query', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));
    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchQuery).toBe('');
    expect(result.current.searchLower).toBe('');
  });

  it('returns all messages when query is empty', () => {
    const messages = makeMessages();
    const { result } = renderHook(() => useMessageSearch({ messages }));
    expect(result.current.filteredMessages).toEqual(messages);
  });

  // ── Filter by query ────────────────────────────────────────────

  it('filters messages by search query (case insensitive)', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => { result.current.setSearchQuery('world'); });

    expect(result.current.filteredMessages).toHaveLength(2);
    expect(result.current.filteredMessages[0].id).toBe('1');
    expect(result.current.filteredMessages[1].id).toBe('3');
  });

  it('returns empty when no messages match', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => { result.current.setSearchQuery('zzz_nomatch'); });

    expect(result.current.filteredMessages).toHaveLength(0);
  });

  it('searchLower reflects lowercase of query', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => { result.current.setSearchQuery('WORLD'); });

    expect(result.current.searchLower).toBe('world');
  });

  // ── handleToggleSearch ─────────────────────────────────────────

  it('handleToggleSearch closes and clears query', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    // Open search first
    act(() => { result.current.handleToggleSearch(); });
    expect(result.current.searchOpen).toBe(true);

    // Set some search state
    act(() => { result.current.setSearchQuery('hello'); });

    // Toggle search off
    act(() => { result.current.handleToggleSearch(); });

    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchQuery).toBe('');
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────

  it('Ctrl+F opens search', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => {
      result.current.handleContainerKeyDown({
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });

    expect(result.current.searchOpen).toBe(true);
  });

  it('Meta+F opens search (macOS)', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => {
      result.current.handleContainerKeyDown({
        key: 'f',
        ctrlKey: false,
        metaKey: true,
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });

    expect(result.current.searchOpen).toBe(true);
  });

  it('Escape closes search and clears query when search is open', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    // Open search first
    act(() => {
      result.current.handleContainerKeyDown({
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });
    expect(result.current.searchOpen).toBe(true);

    // Set a query
    act(() => { result.current.setSearchQuery('test'); });

    // Press Escape
    act(() => {
      result.current.handleContainerKeyDown({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });

    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchQuery).toBe('');
  });

  it('ignores keyboard during IME composition', () => {
    const { result } = renderHook(() => useMessageSearch({ messages: makeMessages() }));

    act(() => {
      result.current.handleContainerKeyDown({
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        nativeEvent: { isComposing: true },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });

    expect(result.current.searchOpen).toBe(false);
  });
});
