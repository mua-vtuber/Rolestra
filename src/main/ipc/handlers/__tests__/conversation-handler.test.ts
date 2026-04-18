import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockListConversations,
  mockGetMessages,
  mockDeleteConversation,
  mockSetActiveSession,
  mockGetActiveSession,
  MockConversationRepository,
} = vi.hoisted(() => {
  const mockListConversations = vi.fn(() => [
    { id: 'conv-1', title: 'Test conversation', createdAt: '2024-01-01' },
    { id: 'conv-2', title: 'Another conversation', createdAt: '2024-01-02' },
  ]);
  const mockGetMessages = vi.fn(() => [
    { id: 'msg-1', content: 'Hello', role: 'user' },
    { id: 'msg-2', content: 'Hi there', role: 'assistant' },
  ]);
  const mockDeleteConversation = vi.fn();
  const mockSetActiveSession = vi.fn();
  const mockGetActiveSession = vi.fn().mockReturnValue(null);
  // Use a regular function so it can be called with `new`
  const MockConversationRepository = vi.fn(function (this: Record<string, unknown>) {
    this.listConversations = mockListConversations;
    this.getMessages = mockGetMessages;
    this.deleteConversation = mockDeleteConversation;
  });
  return {
    mockListConversations,
    mockGetMessages,
    mockDeleteConversation,
    mockSetActiveSession,
    mockGetActiveSession,
    MockConversationRepository,
  };
});

vi.mock('../../../database/conversation-repository', () => ({
  ConversationRepository: MockConversationRepository,
}));

vi.mock('../../../database/connection', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../chat-handler', () => ({
  getActiveSession: mockGetActiveSession,
  setActiveSession: mockSetActiveSession,
}));

import {
  handleConversationList,
  handleConversationLoad,
  handleConversationNew,
  handleConversationDelete,
} from '../conversation-handler';

describe('conversation-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleConversationList', () => {
    it('happy path — returns conversations with default limit/offset', () => {
      const result = handleConversationList({});

      expect(mockListConversations).toHaveBeenCalledWith(50, 0);
      expect(result.conversations).toHaveLength(2);
      expect(result.conversations[0].id).toBe('conv-1');
    });

    it('respects custom limit and offset', () => {
      handleConversationList({ limit: 10, offset: 5 });

      expect(mockListConversations).toHaveBeenCalledWith(10, 5);
    });

    it('service throws — propagates error', () => {
      mockListConversations.mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      expect(() => handleConversationList({})).toThrow('DB connection failed');
    });
  });

  describe('handleConversationLoad', () => {
    it('happy path — returns messages for a conversation', () => {
      const result = handleConversationLoad({ conversationId: 'conv-1' });

      expect(mockGetMessages).toHaveBeenCalledWith('conv-1');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('service throws — propagates error', () => {
      mockGetMessages.mockImplementationOnce(() => {
        throw new Error('Conversation not found');
      });

      expect(() => handleConversationLoad({ conversationId: 'nonexistent' })).toThrow(
        'Conversation not found',
      );
    });
  });

  describe('handleConversationNew', () => {
    it('happy path — resets active session to null', () => {
      const result = handleConversationNew();

      expect(mockSetActiveSession).toHaveBeenCalledWith(null);
      expect(result).toBeUndefined();
    });
  });

  describe('handleConversationDelete', () => {
    it('happy path — deletes conversation and returns success', () => {
      const result = handleConversationDelete({ conversationId: 'conv-1' });

      expect(mockDeleteConversation).toHaveBeenCalledWith('conv-1');
      expect(result.success).toBe(true);
    });

    it('service throws — propagates error', () => {
      mockDeleteConversation.mockImplementationOnce(() => {
        throw new Error('Foreign key constraint');
      });

      expect(() => handleConversationDelete({ conversationId: 'conv-1' })).toThrow(
        'Foreign key constraint',
      );
    });
  });
});
