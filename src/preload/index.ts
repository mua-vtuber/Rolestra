import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcChannelMap, IpcChannel, IpcMeta } from '../shared/ipc-types';
import { CURRENT_SCHEMA_VERSION } from '../shared/ipc-types';
import type { StreamEventMap, StreamEventName } from '../shared/stream-types';

/**
 * Generate a simple unique ID for request tracking.
 * Uses crypto.randomUUID() which is available in Electron's preload context.
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Build IpcMeta with defaults, allowing partial overrides.
 */
function buildMeta(overrides?: Partial<IpcMeta>): IpcMeta {
  return {
    requestId: overrides?.requestId ?? generateRequestId(),
    schemaVersion: overrides?.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    timestamp: overrides?.timestamp ?? Date.now(),
    ...(overrides?.conversationId != null && { conversationId: overrides.conversationId }),
    ...(overrides?.sequence != null && { sequence: overrides.sequence }),
  };
}

/**
 * Type-safe IPC invoke wrapper.
 *
 * This is the ONLY way the renderer process should call the main process.
 * Direct ipcRenderer.invoke() with string literals is forbidden.
 *
 * The wrapper packs { data, meta } and sends it through Electron IPC,
 * then extracts and returns the typed response.
 */
function typedInvoke<C extends IpcChannel>(
  channel: C,
  data: IpcChannelMap[C]['request'],
  meta?: Partial<IpcMeta>,
): Promise<IpcChannelMap[C]['response']> {
  const fullMeta = buildMeta(meta);
  return ipcRenderer.invoke(channel, { data, meta: fullMeta });
}

/**
 * Type-safe event listener for push events from Main process.
 * Returns an unsubscribe function.
 */
function typedOn<E extends StreamEventName>(
  event: E,
  callback: (data: StreamEventMap[E]) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, data: StreamEventMap[E]): void => {
    callback(data);
  };
  ipcRenderer.on(event, listener);
  return () => {
    ipcRenderer.removeListener(event, listener);
  };
}

/** The API surface exposed to the renderer via contextBridge. */
contextBridge.exposeInMainWorld('arena', {
  platform: process.platform,

  /**
   * Type-safe IPC invoke. All renderer → main communication goes through here.
   * Usage: window.arena.invoke('app:ping')
   */
  invoke: typedInvoke,

  /**
   * Type-safe event listener for push events from Main process.
   * Usage: window.arena.on('stream:token', (data) => { ... })
   * Returns an unsubscribe function.
   */
  on: typedOn,
});
