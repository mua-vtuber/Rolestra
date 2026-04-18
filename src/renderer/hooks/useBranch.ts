/**
 * useBranch -- manages conversation branching (fork, switch).
 */

import { useCallback } from 'react';
import { useChatStore } from '../stores/chat-store';

export interface UseBranchReturn {
  currentBranchId: string;
  branches: ReturnType<typeof useChatStore.getState>['branches'];
  handleSwitchBranch: (branchId: string) => void;
  handleFork: (messageId: string) => void;
}

export function useBranch(): UseBranchReturn {
  const currentBranchId = useChatStore((s) => s.currentBranchId);
  const branches = useChatStore((s) => s.branches);
  const forkFromMessage = useChatStore((s) => s.forkFromMessage);
  const switchBranch = useChatStore((s) => s.switchBranch);

  const handleSwitchBranch = useCallback((branchId: string): void => {
    void switchBranch(branchId);
  }, [switchBranch]);

  const handleFork = useCallback((messageId: string): void => {
    void forkFromMessage(messageId);
  }, [forkFromMessage]);

  return {
    currentBranchId,
    branches,
    handleSwitchBranch,
    handleFork,
  };
}
