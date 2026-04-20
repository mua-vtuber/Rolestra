/**
 * queue:* IPC handlers.
 *
 * Surface the 7 queue operations (list / add / reorder / remove /
 * cancel / pause / resume). `remove` and `cancel` are distinct per spec
 * §6 CD-2: `remove` hard-deletes pending/paused rows the user dropped
 * from the list, while `cancel` drives the state machine for in-flight
 * items (emits `'abort-requested'` for the engine to tear down the
 * meeting in Task 20).
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { QueueService } from '../../queue/queue-service';

let queueAccessor: (() => QueueService) | null = null;

export function setQueueServiceAccessor(fn: () => QueueService): void {
  queueAccessor = fn;
}

function getService(): QueueService {
  if (!queueAccessor) {
    throw new Error('queue handler: service not initialized');
  }
  return queueAccessor();
}

/** queue:list */
export function handleQueueList(
  data: IpcRequest<'queue:list'>,
): IpcResponse<'queue:list'> {
  const items = getService().listByProject(data.projectId);
  return { items };
}

/** queue:add */
export function handleQueueAdd(
  data: IpcRequest<'queue:add'>,
): IpcResponse<'queue:add'> {
  const item = getService().add({
    projectId: data.projectId,
    prompt: data.prompt,
    targetChannelId: data.targetChannelId ?? null,
  });
  return { item };
}

/** queue:reorder */
export function handleQueueReorder(
  data: IpcRequest<'queue:reorder'>,
): IpcResponse<'queue:reorder'> {
  getService().reorder(data.projectId, data.orderedIds);
  return { success: true };
}

/** queue:remove */
export function handleQueueRemove(
  data: IpcRequest<'queue:remove'>,
): IpcResponse<'queue:remove'> {
  getService().remove(data.id);
  return { success: true };
}

/** queue:cancel */
export function handleQueueCancel(
  data: IpcRequest<'queue:cancel'>,
): IpcResponse<'queue:cancel'> {
  getService().cancel(data.id);
  return { success: true };
}

/** queue:pause */
export function handleQueuePause(
  data: IpcRequest<'queue:pause'>,
): IpcResponse<'queue:pause'> {
  getService().pause(data.projectId);
  return { success: true };
}

/** queue:resume */
export function handleQueueResume(
  data: IpcRequest<'queue:resume'>,
): IpcResponse<'queue:resume'> {
  getService().resume(data.projectId);
  return { success: true };
}
