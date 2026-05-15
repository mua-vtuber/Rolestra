import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { DesignCheckpointService } from '../../design-checkpoints/design-checkpoint-service';

let checkpointAccessor: (() => DesignCheckpointService) | null = null;

export function setDesignCheckpointServiceAccessor(
  fn: () => DesignCheckpointService,
): void {
  checkpointAccessor = fn;
}

function getCheckpointService(): DesignCheckpointService {
  if (checkpointAccessor === null) {
    throw new Error('[design-checkpoint] service accessor not initialized');
  }
  return checkpointAccessor();
}

export function handleDesignCheckpointGet(
  data: IpcRequest<'design-checkpoint:get'>,
): IpcResponse<'design-checkpoint:get'> {
  return { item: getCheckpointService().get(data.checkpointId) };
}

export function handleDesignCheckpointDecide(
  data: IpcRequest<'design-checkpoint:decide'>,
): IpcResponse<'design-checkpoint:decide'> {
  const checkpoint = getCheckpointService().decide({
    id: data.checkpointId,
    decision: data.decision,
    note: data.note,
  });
  return { checkpoint };
}
