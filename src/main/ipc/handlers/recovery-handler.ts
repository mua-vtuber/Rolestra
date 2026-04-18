/**
 * IPC handlers for recovery:* channels.
 *
 * Bridges renderer recovery requests to RecoveryManager.
 * Lazy-initializes with the singleton database.
 */

import { getDatabase } from '../../database/connection';
import { RecoveryManager } from '../../recovery/recovery-manager';
import type { ConversationSnapshot, StateRecoveryData } from '../../../shared/recovery-types';

let recoveryManager: RecoveryManager | null = null;

function getRecoveryManager(): RecoveryManager {
  if (recoveryManager) return recoveryManager;
  recoveryManager = new RecoveryManager(getDatabase());
  return recoveryManager;
}

export function handleRecoveryList(): { conversations: StateRecoveryData[] } {
  return { conversations: getRecoveryManager().getRecoverableConversations() };
}

export function handleRecoveryRestore(
  data: { conversationId: string },
): { success: boolean; error?: string; snapshot?: ConversationSnapshot } {
  const snapshot = getRecoveryManager().recoverConversation(data.conversationId);
  if (!snapshot) {
    return { success: false, error: 'No recoverable snapshot found' };
  }
  // Return the snapshot so the renderer can restore messages and state
  return { success: true, snapshot };
}

export function handleRecoveryDiscard(data: { conversationId: string }): { success: true } {
  getRecoveryManager().discardRecovery(data.conversationId);
  return { success: true };
}
