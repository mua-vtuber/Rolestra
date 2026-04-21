/**
 * Thin typed wrapper around `window.arena.onStream`.
 *
 * Mirrors `invoke.ts` (Task 0 IPC surface): this module is the ONLY
 * place in the renderer that touches `window.arena.onStream`. Other
 * modules import the `subscribeStream` helper so the call-site enforcement
 * and test-stub semantics stay consistent.
 *
 * The `ArenaBridge.onStream` signature lives in `invoke.ts` so the two
 * wrappers share one global `Window['arena']` declaration.
 */

import type {
  StreamEventType,
  StreamV3PayloadOf,
} from '../../shared/stream-events';

/** Subscribe to a v3 stream event; returns the unsubscribe disposer. */
export function subscribeStream<T extends StreamEventType>(
  type: T,
  callback: (payload: StreamV3PayloadOf<T>) => void,
): () => void {
  const bridge =
    typeof window !== 'undefined' ? window.arena : undefined;
  if (!bridge || typeof bridge.onStream !== 'function') {
    // No preload bridge (e.g. jsdom without a stub) — return a no-op
    // disposer. Tests that exercise the subscription path explicitly
    // stub `window.arena.onStream`.
    return () => {};
  }
  return bridge.onStream(type, callback);
}
