import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcChannelMap, IpcChannel, IpcMeta } from '../shared/ipc-types';
import { CURRENT_SCHEMA_VERSION } from '../shared/ipc-types';
import type { StreamEventMap, StreamEventName } from '../shared/stream-types';
import type {
  StreamEventType,
  StreamV3PayloadOf,
} from '../shared/stream-events';

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

/**
 * R6: type-safe listener for v3 stream-bridge push events. Payload shape
 * is narrowed by `StreamV3PayloadOf<T>` so subscribers never cast. Main
 * sends via `webContents.send(event.type, event.payload)` inside the
 * StreamBridge outbound hook.
 */
function typedOnStream<T extends StreamEventType>(
  type: T,
  callback: (payload: StreamV3PayloadOf<T>) => void,
): () => void {
  // Electron ipcRenderer.on's listener is typed as `(event, ...args: any[])`.
  // Our callback narrows `args[0]` to `StreamV3PayloadOf<T>` for the caller,
  // but the registered listener itself must match Electron's open-ended
  // signature — hence the `unknown[]` spread + single-cast at the invocation
  // boundary. R9-Task1 expanded the StreamEventType union (3 new events) and
  // made the prior generic listener signature uninferable under strict mode.
  const listener = (
    _event: IpcRendererEvent,
    ...args: unknown[]
  ): void => {
    callback(args[0] as StreamV3PayloadOf<T>);
  };
  ipcRenderer.on(type, listener);
  return () => {
    ipcRenderer.removeListener(type, listener);
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
   * Type-safe event listener for v2 conversation/token push events.
   * Usage: window.arena.on('stream:token', (data) => { ... })
   * Returns an unsubscribe function.
   *
   * NOTE: `on` is retained for the v2 orchestrator stream (stream:token /
   * stream:message-start / …). R6+ meeting surfaces use `onStream` below.
   */
  on: typedOn,

  /**
   * R6: type-safe listener for v3 stream-bridge push events.
   * Usage: window.arena.onStream('stream:meeting-turn-token', (payload) => { ... })
   * Returns an unsubscribe function.
   */
  onStream: typedOnStream,
});
