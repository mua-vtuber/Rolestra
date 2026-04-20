/**
 * message:* IPC handlers.
 *
 * User-originated messages go through `message:append` with the literal
 * `author_id='user'` / `author_kind='user'` pair — the FTS search +
 * DB trigger both rely on this contract (spec §7.5). `mentions[]` from
 * the renderer lands in `meta.mentions` so downstream consumers
 * (notifications, SSM facilitator) can pick them up without re-parsing
 * content.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MessageService } from '../../channels/message-service';
import { USER_AUTHOR_LITERAL } from '../../channels/message-service';

let messageAccessor: (() => MessageService) | null = null;

export function setMessageServiceAccessor(fn: () => MessageService): void {
  messageAccessor = fn;
}

function getService(): MessageService {
  if (!messageAccessor) {
    throw new Error('message handler: service not initialized');
  }
  return messageAccessor();
}

/** message:append */
export function handleMessageAppend(
  data: IpcRequest<'message:append'>,
): IpcResponse<'message:append'> {
  const message = getService().append({
    channelId: data.channelId,
    meetingId: data.meetingId ?? null,
    authorId: USER_AUTHOR_LITERAL,
    authorKind: 'user',
    role: 'user',
    content: data.content,
    meta: data.mentions && data.mentions.length > 0
      ? { mentions: data.mentions }
      : null,
  });
  return { message };
}

/** message:list-by-channel */
export function handleMessageListByChannel(
  data: IpcRequest<'message:list-by-channel'>,
): IpcResponse<'message:list-by-channel'> {
  const messages = getService().listByChannel(data.channelId, {
    limit: data.limit,
    before: data.beforeCreatedAt,
  });
  return { messages };
}

/** message:search */
export function handleMessageSearch(
  data: IpcRequest<'message:search'>,
): IpcResponse<'message:search'> {
  const svc = getService();
  const opts =
    data.scope.kind === 'channel'
      ? { channelId: data.scope.channelId, limit: data.limit }
      : { projectId: data.scope.projectId, limit: data.limit };
  const results = svc.search(data.query, opts);
  return { results };
}
