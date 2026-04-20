/**
 * useConversationHistory -- manages conversation list, recovery snapshots,
 * load/delete/new conversation operations.
 */

import { useState, useCallback } from 'react';
import { useChatStore, type ChatMessage } from '../stores/chat-store';
import type { ConversationSummary } from '../../shared/engine-types';
import type { StateRecoveryData } from '../../shared/recovery-types';
import { showError } from './useErrorDialog';

export interface UseConversationHistoryReturn {
  historyOpen: boolean;
  historyList: StateRecoveryData[];
  conversationListOpen: boolean;
  conversationList: ConversationSummary[];
  handleHistoryToggle: () => void;
  handleHistoryRestore: (conversationId: string) => Promise<void>;
  handleHistoryDiscard: (conversationId: string) => Promise<void>;
  handleConversationListToggle: () => void;
  handleLoadConversation: (conversationId: string) => Promise<void>;
  handleDeleteConversation: (conversationId: string) => Promise<void>;
  handleNewConversation: () => void;
}

export function useConversationHistory(): UseConversationHistoryReturn {
  const restoreMessages = useChatStore((s) => s.restoreMessages);
  const setConversationId = useChatStore((s) => s.setConversationId);
  const newConversation = useChatStore((s) => s.newConversation);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<StateRecoveryData[]>([]);
  const [conversationListOpen, setConversationListOpen] = useState(false);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);

  const fetchHistory = useCallback(async (): Promise<void> => {
    try {
      const result = await window.arena.invoke('recovery:list', undefined);
      setHistoryList(result.conversations);
    } catch (err) { showError('recovery:list', err); }
  }, []);

  const fetchConversationList = useCallback(async (): Promise<void> => {
    try {
      const result = await window.arena.invoke('conversation:list', { limit: 50, offset: 0 });
      setConversationList(result.conversations);
    } catch (err) { showError('conversation:list', err); }
  }, []);

  const handleHistoryToggle = useCallback((): void => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      void fetchHistory();
      void fetchConversationList();
    }
  }, [historyOpen, fetchHistory, fetchConversationList]);

  const handleHistoryRestore = useCallback(async (conversationId: string): Promise<void> => {
    try {
      const result = await window.arena.invoke('recovery:restore', { conversationId });
      if (result.success && result.snapshot?.messagesJson) {
        try {
          const msgs = JSON.parse(result.snapshot.messagesJson) as Array<{
            id: string; role: 'user' | 'assistant' | 'system'; content: string;
            speakerName?: string; timestamp: number;
          }>;
          restoreMessages(msgs);
        } catch { /* messagesJson parse failed -- snapshot still restored in backend */ }
      }
      setHistoryOpen(false);
    } catch (err) { showError('recovery:restore', err); }
  }, [restoreMessages]);

  const handleHistoryDiscard = useCallback(async (conversationId: string): Promise<void> => {
    try {
      await window.arena.invoke('recovery:discard', { conversationId });
      await fetchHistory();
    } catch (err) { showError('recovery:discard', err); }
  }, [fetchHistory]);

  const handleConversationListToggle = useCallback((): void => {
    const next = !conversationListOpen;
    setConversationListOpen(next);
    if (next) void fetchConversationList();
  }, [conversationListOpen, fetchConversationList]);

  const handleLoadConversation = useCallback(async (conversationId: string): Promise<void> => {
    try {
      const result = await window.arena.invoke('conversation:load', { conversationId });
      const msgs: ChatMessage[] = result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        speakerName: m.participantName,
        timestamp: new Date(m.createdAt).getTime(),
        responseTimeMs: m.responseTimeMs,
        tokenCount: m.tokenCount,
      }));
      restoreMessages(msgs);
      setConversationId(conversationId);
      setConversationListOpen(false);
    } catch (err) { showError('conversation:load', err); }
  }, [restoreMessages, setConversationId]);

  const handleDeleteConversation = useCallback(async (conversationId: string): Promise<void> => {
    try {
      await window.arena.invoke('conversation:delete', { conversationId });
      await fetchConversationList();
    } catch (err) { showError('conversation:delete', err); }
  }, [fetchConversationList]);

  const handleNewConversation = useCallback((): void => {
    void newConversation();
    setConversationListOpen(false);
  }, [newConversation]);

  return {
    historyOpen,
    historyList,
    conversationListOpen,
    conversationList,
    handleHistoryToggle,
    handleHistoryRestore,
    handleHistoryDiscard,
    handleConversationListToggle,
    handleLoadConversation,
    handleDeleteConversation,
    handleNewConversation,
  };
}
