import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StateRecoveryData, ConversationSnapshot } from '../../../../shared/recovery-types';

const makeSnapshot = (convId = 'conv-1'): ConversationSnapshot => ({
  conversationId: convId,
  participantsJson: '[]',
  roundSetting: 3,
  currentRound: 1,
  totalTokensUsed: 0,
  savedAt: Date.now(),
});

const mockGetRecoverableConversations = vi.fn<() => StateRecoveryData[]>(() => [
  {
    conversationId: 'conv-1',
    snapshot: makeSnapshot(),
    isRecoverable: true,
  },
]);

const mockRecoverConversation = vi.fn<(id: string) => ConversationSnapshot | null>();
const mockDiscardRecovery = vi.fn();

vi.mock('../../../database/connection', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../../../recovery/recovery-manager', () => ({
  RecoveryManager: vi.fn().mockImplementation(function () {
    return {
      getRecoverableConversations: mockGetRecoverableConversations,
      recoverConversation: mockRecoverConversation,
      discardRecovery: mockDiscardRecovery,
    };
  }),
}));

import {
  handleRecoveryList,
  handleRecoveryRestore,
  handleRecoveryDiscard,
} from '../recovery-handler';

describe('recovery-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleRecoveryList', () => {
    it('happy path — returns recoverable conversations', () => {
      const result = handleRecoveryList();

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].conversationId).toBe('conv-1');
      expect(result.conversations[0].isRecoverable).toBe(true);
    });

    it('no recoverable conversations — returns empty array', () => {
      mockGetRecoverableConversations.mockReturnValueOnce([]);

      const result = handleRecoveryList();

      expect(result.conversations).toEqual([]);
    });

    it('service throws — propagates error', () => {
      mockGetRecoverableConversations.mockImplementationOnce(() => {
        throw new Error('Database locked');
      });

      expect(() => handleRecoveryList()).toThrow('Database locked');
    });
  });

  describe('handleRecoveryRestore', () => {
    it('happy path — returns snapshot on successful recovery', () => {
      const snapshot = makeSnapshot('conv-1');
      mockRecoverConversation.mockReturnValueOnce(snapshot);

      const result = handleRecoveryRestore({ conversationId: 'conv-1' });

      expect(result.success).toBe(true);
      expect(result.snapshot).toBe(snapshot);
      expect(result.error).toBeUndefined();
    });

    it('no recoverable snapshot — returns failure with error message', () => {
      mockRecoverConversation.mockReturnValueOnce(null);

      const result = handleRecoveryRestore({ conversationId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No recoverable snapshot found');
      expect(result.snapshot).toBeUndefined();
    });

    it('service throws — propagates error', () => {
      mockRecoverConversation.mockImplementationOnce(() => {
        throw new Error('Corrupted snapshot data');
      });

      expect(() => handleRecoveryRestore({ conversationId: 'conv-1' })).toThrow(
        'Corrupted snapshot data',
      );
    });
  });

  describe('handleRecoveryDiscard', () => {
    it('happy path — discards recovery data and returns success', () => {
      const result = handleRecoveryDiscard({ conversationId: 'conv-1' });

      expect(mockDiscardRecovery).toHaveBeenCalledWith('conv-1');
      expect(result.success).toBe(true);
    });

    it('service throws — propagates error', () => {
      mockDiscardRecovery.mockImplementationOnce(() => {
        throw new Error('Integrity constraint');
      });

      expect(() => handleRecoveryDiscard({ conversationId: 'conv-1' })).toThrow(
        'Integrity constraint',
      );
    });
  });
});
