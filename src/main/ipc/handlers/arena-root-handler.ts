/**
 * arena-root:* IPC handlers.
 *
 * Thin adapters over {@link ArenaRootService}. The service owns filesystem
 * probing and settings persistence; the handler layer only translates
 * IPC requests into method calls. A `setPath` call is explicitly flagged
 * `requiresRestart: true` because the DB handle + service wiring were
 * bound to the previous path at boot.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ArenaRootService } from '../../arena/arena-root-service';

let arenaRootAccessor: (() => ArenaRootService) | null = null;

/** Lazy wiring — set once by main/index.ts after service instantiation. */
export function setArenaRootServiceAccessor(fn: () => ArenaRootService): void {
  arenaRootAccessor = fn;
}

function getService(): ArenaRootService {
  if (!arenaRootAccessor) {
    throw new Error('arena-root handler: service not initialized');
  }
  return arenaRootAccessor();
}

/** arena-root:get */
export function handleArenaRootGet(): IpcResponse<'arena-root:get'> {
  return { path: getService().getPath() };
}

/** arena-root:set */
export function handleArenaRootSet(
  data: IpcRequest<'arena-root:set'>,
): IpcResponse<'arena-root:set'> {
  getService().setPath(data.path);
  return { success: true, requiresRestart: true };
}

/** arena-root:status */
export async function handleArenaRootStatus(): Promise<
  IpcResponse<'arena-root:status'>
> {
  const status = await getService().getStatus();
  return { status };
}
