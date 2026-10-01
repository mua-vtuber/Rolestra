/**
 * arena-root:* IPC handlers.
 *
 * Thin adapters over {@link ArenaRootService}. The service owns filesystem
 * probing and settings persistence; the handler layer only translates
 * IPC requests into method calls.
 *
 * `arena-root:open-folder` (spec 2026-10-01-messenger-redesign.md R5-3)
 * opens the ArenaRoot — the conversation-log folder the settings screen
 * shows — in the OS file manager. The renderer sends no path: main opens
 * only the folder it resolved itself.
 */

import { shell } from 'electron';

import type { IpcResponse } from '../../../shared/ipc-types';
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

/**
 * arena-root:open-folder — `shell.openPath` resolves to an empty string on
 * success and to an error description on failure; the latter is thrown so
 * the settings screen shows it instead of a button that silently did nothing.
 */
export async function handleArenaRootOpenFolder(): Promise<IpcResponse<'arena-root:open-folder'>> {
  const folder = getService().getPath();
  const failure = await shell.openPath(folder);
  if (failure.length > 0) {
    throw new Error(`Could not open the conversation-log folder ${folder}: ${failure}`);
  }
  return { success: true };
}
