/**
 * useStream — React hook for receiving streaming events from Main process.
 *
 * Subscribes to stream events via window.arena.on() and provides
 * callbacks for token updates, message lifecycle, and state changes.
 */

import { useEffect, useRef } from 'react';
import type { StreamEventMap, StreamEventName } from '../../shared/stream-types';

/**
 * Subscribe to a single stream event type.
 * Returns cleanup function automatically on unmount.
 */
export function useStreamEvent<E extends StreamEventName>(
  event: E,
  callback: (data: StreamEventMap[E]) => void,
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const handler = (data: StreamEventMap[E]): void => {
      callbackRef.current(data);
    };
    const unsubscribe = window.arena.on(event, handler);
    return unsubscribe;
  }, [event]);
}
