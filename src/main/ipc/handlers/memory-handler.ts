/**
 * IPC handlers for memory channels.
 *
 * Bridges renderer memory requests to MemoryFacade.
 */

import type { IpcRequest } from '../../../shared/ipc-types';
import type { KnowledgeNode, MemorySearchResult, ExtractionResult, AssembledContext } from '../../../shared/memory-types';
import { getMemoryFacade } from '../../memory/instance';
import { getActiveSession } from './chat-handler';

/**
 * Handle memory:pin — pin a message to memory.
 *
 * Looks up message content from the active conversation session,
 * then delegates to MemoryFacade.pinMessage().
 */
export async function handleMemoryPin(
  data: IpcRequest<'memory:pin'>,
): Promise<{ success: true; nodeId: string }> {
  const facade = getMemoryFacade();

  // Look up message content from the active session
  const session = getActiveSession();
  const message = session?.messages.find((m) => m.id === data.messageId);
  const content = message
    ? (typeof message.content === 'string' ? message.content : '')
    : '';

  if (!content) {
    throw new Error(`Message not found or empty: ${data.messageId}`);
  }

  const nodeId = facade.pinMessage(data.messageId, content, data.topic);
  return { success: true, nodeId };
}

/**
 * Handle memory:search — search memory for relevant knowledge.
 */
export async function handleMemorySearch(
  data: IpcRequest<'memory:search'>,
): Promise<{ results: MemorySearchResult[] }> {
  const facade = getMemoryFacade();
  const results = await facade.searchForIpc(data.query, {
    topic: data.topic,
    limit: data.limit,
  });
  return { results };
}

/**
 * Handle memory:reindex — reindex all node embeddings.
 *
 * Clears existing embeddings and regenerates them using the
 * currently configured embedding provider. Used when the
 * embedding provider changes.
 */
export async function handleMemoryReindex(): Promise<{ reindexed: number }> {
  const facade = getMemoryFacade();
  const reindexed = await facade.reindexEmbeddings();
  return { reindexed };
}

/**
 * Handle memory:get-node — get a single knowledge node by ID.
 */
export function handleMemoryGetNode(
  data: IpcRequest<'memory:get-node'>,
): { node: KnowledgeNode | null } {
  const facade = getMemoryFacade();
  return { node: facade.getNode(data.id) };
}

/**
 * Handle memory:delete-node — soft-delete a knowledge node.
 */
export function handleMemoryDeleteNode(
  data: IpcRequest<'memory:delete-node'>,
): { deleted: boolean } {
  const facade = getMemoryFacade();
  return { deleted: facade.deleteNode(data.id) };
}

/**
 * Handle memory:get-pinned — get all pinned knowledge nodes.
 */
export function handleMemoryGetPinned(
  data: IpcRequest<'memory:get-pinned'>,
): { nodes: KnowledgeNode[] } {
  const facade = getMemoryFacade();
  return { nodes: facade.getPinnedNodes(data.topic) };
}

/**
 * Handle memory:extract-preview — extract without storing (preview).
 */
export function handleMemoryExtractPreview(
  data: IpcRequest<'memory:extract-preview'>,
): ExtractionResult {
  const facade = getMemoryFacade();
  return facade.extractOnly(data.messages);
}

/**
 * Handle memory:get-context — retrieve assembled memory context.
 */
export async function handleMemoryGetContext(
  data: IpcRequest<'memory:get-context'>,
): Promise<AssembledContext> {
  const facade = getMemoryFacade();
  return facade.getAssembledContext({ query: data.query, topic: data.topic });
}

/**
 * Handle memory:extract-and-store — run extraction pipeline and store results.
 */
export async function handleMemoryExtractAndStore(
  data: IpcRequest<'memory:extract-and-store'>,
): Promise<{ stored: number; skipped: number; mentions: number; conflicts: number }> {
  const facade = getMemoryFacade();
  const annotated = data.messages.map((m) => ({
    ...m,
    role: 'assistant' as const,
    id: '',
    timestamp: Date.now(),
  }));
  return facade.extractAndStorePipeline(annotated, data.conversationId);
}
