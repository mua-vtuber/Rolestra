/**
 * Structured IPC error type shared between main and renderer.
 *
 * All IPC handler errors are wrapped in this format before being
 * thrown/serialized across the process boundary.
 */

/** Error codes for categorizing IPC failures. */
export type IpcErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'EXECUTION_ERROR'
  | 'CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'INTERNAL_ERROR';

/** Structured error shape serialized across IPC boundary. */
export interface IpcErrorPayload {
  code: IpcErrorCode;
  message: string;
  channel: string;
}

/**
 * Extract a user-facing message from an unknown error.
 * Strips internal details while preserving actionable information.
 */
export function formatIpcError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}
