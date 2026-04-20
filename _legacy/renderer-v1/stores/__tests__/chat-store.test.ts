/**
 * Chat store unit tests.
 *
 * Tests Zustand store actions directly without rendering React components.
 * window.arena is mocked for actions that invoke IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore, type ChatMessage } from '../chat-store';

// ── Mock window.arena ──────────────────────────────────────────────────

const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('window', {
  arena: { invoke: invokeMock, on: vi.fn(() => vi.fn()) },
  dispatchEvent: vi.fn(),
  CustomEvent: class CustomEvent { detail: unknown; constructor(_type: string, opts?: { detail?: unknown }) { this.detail = opts?.detail; } },
});

// ── Mock showError to avoid side effects ───────────────────────────────

vi.mock('../../hooks/useErrorDialog', () => ({
  showError: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    speakerName: 'AI',
    timestamp: Date.now(),
    ...overrides,
  };
}

function resetStore(): void {
  useChatStore.setState({
    messages: [],
    sending: false,
    paused: false,
    conversationState: 'idle',
    currentBranchId: 'main',
    branches: [],
    conversationId: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('chat-store', () => {
  beforeEach(() => {
    resetStore();
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  // ── addMessage ─────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('appends a message to the messages array', () => {
      const msg = makeMessage({ id: 'msg-1', content: 'Hello' });
      useChatStore.getState().addMessage(msg);

      const { messages } = useChatStore.getState();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(msg);
    });

    it('appends multiple messages in order', () => {
      const msg1 = makeMessage({ id: 'msg-1', content: 'First' });
      const msg2 = makeMessage({ id: 'msg-2', content: 'Second' });
      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);

      const { messages } = useChatStore.getState();
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[1].id).toBe('msg-2');
    });
  });

  // ── appendToken ────────────────────────────────────────────────────

  describe('appendToken', () => {
    it('updates the correct message content', () => {
      const msg = makeMessage({ id: 'stream-1', content: 'Hello', streaming: true });
      useChatStore.getState().addMessage(msg);

      useChatStore.getState().appendToken('stream-1', ' World');
      const { messages } = useChatStore.getState();
      expect(messages[0].content).toBe('Hello World');
    });

    it('does not affect other messages', () => {
      const msg1 = makeMessage({ id: 'msg-1', content: 'Keep me' });
      const msg2 = makeMessage({ id: 'msg-2', content: 'Change me', streaming: true });
      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);

      useChatStore.getState().appendToken('msg-2', '!');
      const { messages } = useChatStore.getState();
      expect(messages[0].content).toBe('Keep me');
      expect(messages[1].content).toBe('Change me!');
    });

    it('handles non-existent message ID gracefully', () => {
      const msg = makeMessage({ id: 'msg-1', content: 'Hello' });
      useChatStore.getState().addMessage(msg);

      // Should not throw
      useChatStore.getState().appendToken('non-existent', ' token');
      const { messages } = useChatStore.getState();
      expect(messages[0].content).toBe('Hello');
    });
  });

  // ── finalizeMessage ────────────────────────────────────────────────

  describe('finalizeMessage', () => {
    it('sets streaming=false and adds metadata', () => {
      const msg = makeMessage({ id: 'stream-1', content: 'Done', streaming: true });
      useChatStore.getState().addMessage(msg);

      useChatStore.getState().finalizeMessage('stream-1', 42, 1500);
      const { messages } = useChatStore.getState();
      expect(messages[0].streaming).toBe(false);
      expect(messages[0].tokenCount).toBe(42);
      expect(messages[0].responseTimeMs).toBe(1500);
    });

    it('handles null tokenCount by omitting it', () => {
      const msg = makeMessage({ id: 'stream-1', content: 'Done', streaming: true });
      useChatStore.getState().addMessage(msg);

      useChatStore.getState().finalizeMessage('stream-1', null, 800);
      const { messages } = useChatStore.getState();
      expect(messages[0].streaming).toBe(false);
      expect(messages[0].tokenCount).toBeUndefined();
      expect(messages[0].responseTimeMs).toBe(800);
    });
  });

  // ── newConversation ────────────────────────────────────────────────

  describe('newConversation', () => {
    it('clears messages and resets state', async () => {
      useChatStore.setState({
        messages: [makeMessage({ id: 'old-1' })],
        sending: true,
        paused: true,
        conversationState: 'running',
        currentBranchId: 'branch-1',
        branches: [{ id: 'branch-1', parentBranchId: null, branchRootMessageId: 'msg-1', createdAt: Date.now() }],
        conversationId: 'conv-1',
      });

      await useChatStore.getState().newConversation();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.sending).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.conversationState).toBe('idle');
      expect(state.currentBranchId).toBe('main');
      expect(state.branches).toHaveLength(0);
      expect(state.conversationId).toBeNull();
    });

    it('invokes conversation:new on the backend', async () => {
      await useChatStore.getState().newConversation();
      expect(invokeMock).toHaveBeenCalledWith('conversation:new', undefined);
    });
  });

  // ── restoreMessages ────────────────────────────────────────────────

  describe('restoreMessages', () => {
    it('replaces message array and resets flags', () => {
      useChatStore.setState({
        messages: [makeMessage({ id: 'old-1' })],
        sending: true,
        paused: true,
        conversationState: 'running',
      });

      const newMsgs = [
        makeMessage({ id: 'restored-1', content: 'Restored A' }),
        makeMessage({ id: 'restored-2', content: 'Restored B' }),
      ];
      useChatStore.getState().restoreMessages(newMsgs);

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('restored-1');
      expect(state.messages[1].id).toBe('restored-2');
      expect(state.sending).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.conversationState).toBe('idle');
    });
  });

  // ── switchBranch ───────────────────────────────────────────────────

  describe('switchBranch', () => {
    it('invokes chat:switch-branch and updates state', async () => {
      invokeMock.mockImplementation(async (channel: string) => {
        if (channel === 'chat:switch-branch') return undefined;
        if (channel === 'chat:list-branches') return {
          currentBranchId: 'branch-2',
          branches: [
            { id: 'branch-2', parentBranchId: null, branchRootMessageId: 'msg-1', createdAt: Date.now() },
          ],
        };
        return undefined;
      });

      useChatStore.setState({
        messages: [makeMessage({ id: 'old' })],
        sending: true,
      });

      await useChatStore.getState().switchBranch('branch-2');

      const state = useChatStore.getState();
      expect(state.currentBranchId).toBe('branch-2');
      expect(state.messages).toHaveLength(0);
      expect(state.sending).toBe(false);
      expect(invokeMock).toHaveBeenCalledWith('chat:switch-branch', { branchId: 'branch-2' });
    });
  });

  // ── forkFromMessage ────────────────────────────────────────────────

  describe('forkFromMessage', () => {
    it('truncates messages to fork point and updates branch info', async () => {
      const msg1 = makeMessage({ id: 'msg-1', content: 'First' });
      const msg2 = makeMessage({ id: 'msg-2', content: 'Second' });
      const msg3 = makeMessage({ id: 'msg-3', content: 'Third' });
      useChatStore.setState({ messages: [msg1, msg2, msg3] });

      invokeMock.mockImplementation(async (channel: string) => {
        if (channel === 'chat:fork') return { branchId: 'fork-1', branchRootMessageId: 'msg-2' };
        if (channel === 'chat:list-branches') return {
          currentBranchId: 'fork-1',
          branches: [
            { id: 'fork-1', parentBranchId: 'main', branchRootMessageId: 'msg-2', createdAt: Date.now() },
          ],
        };
        return undefined;
      });

      await useChatStore.getState().forkFromMessage('msg-2');

      const state = useChatStore.getState();
      // Messages should be truncated to include msg-1 and msg-2 only
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('msg-1');
      expect(state.messages[1].id).toBe('msg-2');
      expect(state.currentBranchId).toBe('fork-1');
      expect(state.branches).toHaveLength(1);
    });
  });

  // ── setConversationState ───────────────────────────────────────────

  describe('setConversationState', () => {
    it('sets running state with correct flags', () => {
      useChatStore.getState().setConversationState('running');
      const state = useChatStore.getState();
      expect(state.conversationState).toBe('running');
      expect(state.sending).toBe(true);
      expect(state.paused).toBe(false);
    });

    it('sets paused state with correct flags', () => {
      useChatStore.getState().setConversationState('paused');
      const state = useChatStore.getState();
      expect(state.conversationState).toBe('paused');
      expect(state.sending).toBe(false);
      expect(state.paused).toBe(true);
    });

    it('sets idle state with correct flags', () => {
      useChatStore.setState({ sending: true, paused: true });
      useChatStore.getState().setConversationState('idle');
      const state = useChatStore.getState();
      expect(state.conversationState).toBe('idle');
      expect(state.sending).toBe(false);
      expect(state.paused).toBe(false);
    });
  });

  // ── clearMessages ──────────────────────────────────────────────────

  describe('clearMessages', () => {
    it('resets all state to initial values', () => {
      useChatStore.setState({
        messages: [makeMessage()],
        sending: true,
        paused: true,
        conversationState: 'running',
        currentBranchId: 'branch-1',
        branches: [{ id: 'branch-1', parentBranchId: null, branchRootMessageId: 'msg-1', createdAt: Date.now() }],
        conversationId: 'conv-1',
      });

      useChatStore.getState().clearMessages();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.sending).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.conversationState).toBe('idle');
      expect(state.currentBranchId).toBe('main');
      expect(state.branches).toHaveLength(0);
      expect(state.conversationId).toBeNull();
    });
  });
});
