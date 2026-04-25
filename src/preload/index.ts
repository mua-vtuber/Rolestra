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

/**
 * R11-Task4: __rolestraDevHooks — Playwright Electron E2E debug hooks.
 *
 * Exposed only when `process.env.ROLESTRA_E2E === '1'` so a production
 * renderer (or DevTools console of an end-user build) cannot reach the
 * trip surface. The matching IPC handler in `src/main/ipc/router.ts` is
 * gated on the same env var — both gates have to fail open for the trip
 * channel to exist, which is impossible in a production-built bundle
 * because the launcher never sets the variable.
 *
 * The four `trip*` functions wrap the single
 * `dev:trip-circuit-breaker` channel with a discriminated payload so an
 * E2E spec writes the same call shape documented in the R11 plan:
 *
 *     await window.__rolestraDevHooks.tripFilesPerTurn(21);
 *
 * Each returns a Promise resolving to the handler's structured response
 * `{ ok, projectId, tripwire }` so the spec can assert the trip applied.
 */
if (process.env.ROLESTRA_E2E === '1') {
  contextBridge.exposeInMainWorld('__rolestraDevHooks', {
    tripFilesPerTurn(count: number, projectId?: string) {
      return typedInvoke('dev:trip-circuit-breaker', {
        tripwire: 'files_per_turn',
        count,
        ...(projectId !== undefined && { projectId }),
      });
    },
    tripCumulativeCliMs(ms: number, projectId?: string) {
      return typedInvoke('dev:trip-circuit-breaker', {
        tripwire: 'cumulative_cli_ms',
        ms,
        ...(projectId !== undefined && { projectId }),
      });
    },
    tripQueueStreak(count: number, projectId?: string) {
      return typedInvoke('dev:trip-circuit-breaker', {
        tripwire: 'queue_streak',
        count,
        ...(projectId !== undefined && { projectId }),
      });
    },
    tripSameError(category: string, count: number, projectId?: string) {
      return typedInvoke('dev:trip-circuit-breaker', {
        tripwire: 'same_error',
        category,
        count,
        ...(projectId !== undefined && { projectId }),
      });
    },
  });
  console.info('[rolestra] __rolestraDevHooks exposed (ROLESTRA_E2E=1)');
}
