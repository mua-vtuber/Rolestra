/**
 * How a handler error crosses IPC. Electron passes only the message, so the
 * message carries a category code and, when the error names one, a known
 * cause the renderer reads back (`shared/ipc-error.ts`, QA High-1).
 */
import {
  IPC_ERROR_CAUSES,
  ipcCauseTag,
  type IpcErrorCause,
  type IpcErrorCode,
} from '../../shared/ipc-error';

export function classifyError(err: unknown): IpcErrorCode {
  if (!(err instanceof Error)) return 'INTERNAL_ERROR';
  const msg = err.message.toLowerCase();
  if (msg.includes('not found') || msg.includes('not exist')) return 'NOT_FOUND';
  if (msg.includes('not initialized') || msg.includes('no active')) return 'INVALID_STATE';
  if (msg.includes('validation') || msg.includes('invalid')) return 'VALIDATION_ERROR';
  if (msg.includes('permission') || msg.includes('denied')) return 'PERMISSION_DENIED';
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('timeout')) return 'NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

function causeOf(err: unknown): IpcErrorCause | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as { ipcCause?: unknown }).ipcCause;
  return typeof cause === 'string' && (IPC_ERROR_CAUSES as readonly string[]).includes(cause)
    ? (cause as IpcErrorCause)
    : null;
}

/** The error the router rethrows: `[CODE] {cause:x} message` (the tag only for a known cause). */
export function toTransportError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const cause = causeOf(err);
  const tagged = cause === null ? message : `${ipcCauseTag(cause)} ${message}`;
  const structured = new Error(`[${classifyError(err)}] ${tagged}`);
  structured.name = 'IpcError';
  return structured;
}
