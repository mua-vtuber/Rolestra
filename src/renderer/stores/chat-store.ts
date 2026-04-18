/**
 * Chat Zustand store.
 *
 * Manages chat messages and conversation controls (send/pause/resume/stop).
 * Supports streaming: messages are created on stream:message-start,
 * updated token-by-token on stream:token, and finalized on stream:message-done.
 * Supports branch management for conversation forking.
 */

import { create } from 'zustand';
import type { BranchInfo } from '../../shared/engine-types';
import { showError } from '../hooks/useErrorDialog';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  speakerName?: string;
  timestamp: number;
  /** Response time in milliseconds (AI messages only). */
  responseTimeMs?: number;
  /** Token count for this message. */
  tokenCount?: number;
  /** Whether this message is still being streamed. */
  streaming?: boolean;
  /** Round number this message belongs to. */
  round?: number;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  paused: boolean;
  conversationState: 'idle' | 'running' | 'paused' | 'stopped';
  /** Current active branch ID. */
  currentBranchId: string;
  /** All branches in the conversation. */
  branches: BranchInfo[];
  /** ID of the currently active persisted conversation. */
  conversationId: string | null;

  send: (content: string, activeProviderIds?: string[], attachments?: string[]) => Promise<void>;
  /** Send a user message mid-round without altering sending/paused flags. */
  interject: (content: string, activeProviderIds?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  addMessage: (message: ChatMessage) => void;
  /** Append a token to an existing streaming message. */
  appendToken: (messageId: string, token: string) => void;
  /** Finalize a streaming message with metadata. */
  finalizeMessage: (messageId: string, tokenCount: number | null, responseTimeMs: number, parsedContent?: string) => void;
  /** Update the conversation state. */
  setConversationState: (state: ChatState['conversationState']) => void;
  clearMessages: () => void;
  /** Bulk-load messages from a recovery snapshot. */
  restoreMessages: (messages: ChatMessage[]) => void;
  /** Set the active conversation ID. */
  setConversationId: (id: string | null) => void;
  /** Start a new conversation (reset state + notify backend). */
  newConversation: () => Promise<void>;
  /** Fork the conversation from a message. */
  forkFromMessage: (messageId: string) => Promise<void>;
  /** Switch to a different branch. */
  switchBranch: (branchId: string) => Promise<void>;
  /** Refresh the branch list from backend. */
  fetchBranches: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sending: false,
  paused: false,
  conversationState: 'idle',
  currentBranchId: 'main',
  branches: [],
  conversationId: null,

  send: async (content, activeProviderIds, attachments) => {
    // Add user message immediately to the store
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      speakerName: 'User',
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, userMsg],
      sending: true,
    }));

    try {
      await window.arena.invoke('chat:send', { content, activeProviderIds, attachments });
    } catch (err) {
      set({ sending: false });
      showError('chat:send', err);
    }
  },

  interject: async (content, activeProviderIds) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      speakerName: 'User',
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, userMsg],
    }));
    try {
      await window.arena.invoke('chat:send', { content, activeProviderIds });
    } catch (err) {
      showError('chat:send', err);
    }
  },

  pause: async () => {
    try {
      await window.arena.invoke('chat:pause', undefined);
      set({ paused: true });
    } catch (err) {
      showError('chat:pause', err);
    }
  },

  resume: async () => {
    try {
      await window.arena.invoke('chat:resume', undefined);
      set({ paused: false });
    } catch (err) {
      showError('chat:resume', err);
    }
  },

  stop: async () => {
    try {
      await window.arena.invoke('chat:stop', undefined);
      set({ sending: false, paused: false, conversationState: 'stopped' });
    } catch (err) {
      showError('chat:stop', err);
    }
  },

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  appendToken: (messageId, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + token } : m,
      ),
    })),

  finalizeMessage: (messageId, tokenCount, responseTimeMs, parsedContent) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              ...(tokenCount != null ? { tokenCount } : {}),
              ...(parsedContent != null ? { content: parsedContent } : {}),
              responseTimeMs,
              streaming: false,
            }
          : m,
      ),
    })),

  setConversationState: (conversationState) =>
    set({
      conversationState,
      sending: conversationState === 'running',
      paused: conversationState === 'paused',
    }),

  clearMessages: () =>
    set({ messages: [], sending: false, paused: false, conversationState: 'idle', currentBranchId: 'main', branches: [], conversationId: null }),

  restoreMessages: (messages) =>
    set({ messages, sending: false, paused: false, conversationState: 'idle' }),

  setConversationId: (id) => set({ conversationId: id }),

  newConversation: async () => {
    try {
      await window.arena.invoke('conversation:new', undefined);
      set({ messages: [], sending: false, paused: false, conversationState: 'idle', currentBranchId: 'main', branches: [], conversationId: null });
    } catch (err) {
      showError('conversation:new', err);
    }
  },

  forkFromMessage: async (messageId) => {
    try {
      const result = await window.arena.invoke('chat:fork', { messageId });
      // After forking, fetch branches and truncate displayed messages
      const branchResult = await window.arena.invoke('chat:list-branches', undefined);
      set((state) => {
        // Keep only messages up to the fork point
        const forkIndex = state.messages.findIndex((m) => m.id === messageId);
        const keptMessages = forkIndex >= 0
          ? state.messages.slice(0, forkIndex + 1)
          : state.messages;
        return {
          messages: keptMessages,
          currentBranchId: result.branchId,
          branches: branchResult.branches,
          sending: false,
          paused: false,
        };
      });
    } catch (err) {
      showError('chat:fork', err);
    }
  },

  switchBranch: async (branchId) => {
    try {
      await window.arena.invoke('chat:switch-branch', { branchId });
      const branchResult = await window.arena.invoke('chat:list-branches', undefined);
      set({
        currentBranchId: branchResult.currentBranchId,
        branches: branchResult.branches,
        messages: [],
        sending: false,
        paused: false,
      });
    } catch (err) {
      showError('chat:switch-branch', err);
    }
  },

  fetchBranches: async () => {
    try {
      const result = await window.arena.invoke('chat:list-branches', undefined);
      set({
        currentBranchId: result.currentBranchId,
        branches: result.branches,
      });
    } catch (err) {
      showError('chat:list-branches', err);
    }
  },
}));
