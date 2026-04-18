/**
 * Handler for 'conversation:*' IPC channels.
 *
 * Manages persisted conversation CRUD: list, load, new, delete.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import { getDatabase } from '../../database/connection';
import { ConversationRepository } from '../../database/conversation-repository';
import { getActiveSession, setActiveSession } from './chat-handler';

/** conversation:list — list persisted conversations. */
export function handleConversationList(
  data: IpcRequest<'conversation:list'>,
): IpcResponse<'conversation:list'> {
  const repo = new ConversationRepository(getDatabase());
  const conversations = repo.listConversations(data?.limit ?? 50, data?.offset ?? 0);
  return { conversations };
}

/** conversation:load — load messages for a conversation. */
export function handleConversationLoad(
  data: IpcRequest<'conversation:load'>,
): IpcResponse<'conversation:load'> {
  const repo = new ConversationRepository(getDatabase());
  const messages = repo.getMessages(data.conversationId);
  return { messages };
}

/** conversation:new — reset to a new conversation. */
export function handleConversationNew(): IpcResponse<'conversation:new'> {
  setActiveSession(null);
  return undefined;
}

/** conversation:delete — delete a conversation and its messages. */
export function handleConversationDelete(
  data: IpcRequest<'conversation:delete'>,
): IpcResponse<'conversation:delete'> {
  const repo = new ConversationRepository(getDatabase());
  repo.deleteConversation(data.conversationId);
  const active = getActiveSession();
  if (active && active.id === data.conversationId) {
    setActiveSession(null);
  }
  return { success: true };
}
