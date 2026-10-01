/**
 * Handler for 'app:*' IPC channels.
 *
 * Each exported function corresponds to one channel in IpcChannelMap.
 * The router registers these via ipcMain.handle().
 */

import type { IpcResponse } from '../../../shared/ipc-types';
import { APP_NAME, APP_VERSION } from '../../../shared/constants';

/**
 * app:ping — simple health check.
 * Returns { pong: true, timestamp } so the renderer can verify IPC is alive.
 */
export function handlePing(): IpcResponse<'app:ping'> {
  return { pong: true, timestamp: Date.now() };
}

/**
 * app:get-info — returns application identity.
 * Values come from shared constants so they stay in sync across processes.
 */
export function handleGetInfo(): IpcResponse<'app:get-info'> {
  return { name: APP_NAME, version: APP_VERSION };
}
