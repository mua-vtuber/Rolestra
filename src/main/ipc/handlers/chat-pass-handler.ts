/**
 * chat:pass-turn IPC handler (spec 2026-10-01 F1). The router has already
 * checked that the channel is a chat channel; the pass service decides
 * whether this channel may pass now and throws a named refusal otherwise.
 */
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChatPassService } from '../../channels/chat-pass-service';

let passAccessor: (() => ChatPassService) | null = null;

export function setChatPassServiceAccessor(fn: () => ChatPassService): void {
  passAccessor = fn;
}

function getService(): ChatPassService {
  if (!passAccessor) throw new Error('chat pass handler: service not initialized');
  return passAccessor();
}

/** chat:pass-turn */
export function handleChatPassTurn(data: IpcRequest<'chat:pass-turn'>): IpcResponse<'chat:pass-turn'> {
  return { message: getService().pass(data.channelId) };
}
