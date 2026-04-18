/**
 * useMessageSearch -- manages in-chat message search (Ctrl+F) state,
 * filtered messages, and keyboard shortcuts.
 */

import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '../stores/chat-store';

export interface UseMessageSearchReturn {
  searchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  filteredMessages: ChatMessage[];
  searchLower: string;
  hasStreamingBubble: boolean;
  handleToggleSearch: () => void;
  handleContainerKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export interface UseMessageSearchParams {
  messages: ChatMessage[];
}

export function useMessageSearch(params: UseMessageSearchParams): UseMessageSearchReturn {
  const { messages } = params;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchLower = searchQuery.toLowerCase();
  const filteredMessages = searchQuery
    ? messages.filter((m) => m.content.toLowerCase().includes(searchLower))
    : messages;
  const hasStreamingBubble = filteredMessages.some((m) => m.streaming);

  const handleToggleSearch = useCallback((): void => {
    setSearchOpen((prev) => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  }, []);

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    if (e.key === 'Escape' && searchOpen) {
      setSearchOpen(false);
      setSearchQuery('');
    }
  }, [searchOpen]);

  return {
    searchOpen,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    filteredMessages,
    searchLower,
    hasStreamingBubble,
    handleToggleSearch,
    handleContainerKeyDown,
  };
}
