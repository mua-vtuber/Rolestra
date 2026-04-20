/**
 * useErrorDialog — shows a native error dialog for IPC and runtime errors.
 *
 * Returns a function that can be called in catch blocks instead of silently
 * swallowing errors. Uses window.alert for now; will be replaced by a
 * proper toast/dialog component in Phase H.
 */

import { useCallback } from 'react';
import { formatIpcError } from '../../shared/ipc-error';

/**
 * Show an error dialog to the user.
 * Standalone function for use outside React components (stores, etc).
 */
export function showError(context: string, err: unknown): void {
  const message = formatIpcError(err);
  console.error(`[${context}]`, err);
  // Phase H will replace this with a toast notification system.
  // For now, use a non-blocking approach: dispatch a custom event
  // that a top-level error boundary can pick up.
  window.dispatchEvent(
    new CustomEvent('arena:error', { detail: { context, message } }),
  );
}

/**
 * React hook returning a memoized error handler.
 *
 * @example
 * ```tsx
 * const handleError = useErrorDialog();
 * try {
 *   await window.arena.invoke('config:set-secret', { key, value });
 * } catch (err) {
 *   handleError('설정 저장', err);
 * }
 * ```
 */
export function useErrorDialog(): (context: string, err: unknown) => void {
  return useCallback((context: string, err: unknown) => {
    showError(context, err);
  }, []);
}
