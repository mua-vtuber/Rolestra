/**
 * Thin typed wrapper around `window.arena.invoke`.
 *
 * This is the ONLY module in the renderer that is allowed to reference
 * `window.arena.invoke(...)`. Everything else must go through `invoke()`
 * exported here. A grep guard in CI enforces this.
 *
 * Behaviour:
 * - Forwards `channel` and `data` to the preload-exposed bridge as-is.
 * - If the bridge is missing (test environment without preload), throws.
 *   We do not silently no-op — the caller must see the failure.
 * - If the Main-side handler rejects, we re-throw the rejection reason
 *   unchanged. No retry, no timeout, no wrapping. Callers (hooks → UI)
 *   need the original error object for error UX.
 */
import type {
  IpcChannel,
  IpcChannelMap,
  IpcMeta,
  IpcRequest,
  IpcResponse,
} from '../../shared/ipc-types';

/**
 * The shape the preload contextBridge exposes on `window.arena`.
 *
 * Only `invoke` is consumed by this wrapper. Event subscriptions go
 * through dedicated hooks that reference the preload bridge directly
 * when they need `window.arena.on`.
 */
interface ArenaBridge {
  /**
   * `process.platform` value forwarded by the preload bridge.
   * We keep it loose here — the renderer only reads it, never narrows it.
   */
  readonly platform: string;
  invoke<C extends IpcChannel>(
    channel: C,
    data: IpcRequest<C>,
    meta?: Partial<IpcMeta>,
  ): Promise<IpcResponse<C>>;
}

declare global {
  interface Window {
    arena?: ArenaBridge;
  }
}

/**
 * Typed IPC invoker.
 *
 * @throws Error('arena bridge not available') when running outside Electron
 *         (e.g. a test that forgot to stub `window.arena`).
 * @throws The original rejection reason from the Main-side handler.
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  data: IpcChannelMap[C]['request'],
): Promise<IpcChannelMap[C]['response']> {
  const bridge = typeof window !== 'undefined' ? window.arena : undefined;
  if (!bridge) {
    throw new Error('arena bridge not available');
  }
  return bridge.invoke(channel, data);
}
