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

/**
 * Failure causes main names on purpose so the renderer can say why an
 * action failed (QA High-1, 2026-10-01). Electron passes only an error's
 * message across IPC (wrapped as "Error invoking remote method '<channel>':
 * <name>: <message>"), so the router writes the cause as a tag at the start
 * of main's message (`main/ipc/ipc-transport-error.ts`) and the renderer
 * reads it back with {@link readIpcErrorCause}.
 *
 * - `duplicate-display-name`: another AI already uses that name.
 * - `local-ai-not-ready`: Ollama was no longer running (or had no models)
 *   at the resolved address when the add was attempted.
 * - `local-model-missing`: Ollama is running but lacks the chosen model.
 */
export const IPC_ERROR_CAUSES = [
  'duplicate-display-name',
  'local-ai-not-ready',
  'local-model-missing',
] as const;

export type IpcErrorCause = (typeof IPC_ERROR_CAUSES)[number];

/** A main-side error that carries one of the known causes. */
export interface IpcCausedError extends Error {
  readonly ipcCause: IpcErrorCause;
}

const CAUSE_TAG_PATTERN = /\{cause:([a-z-]+)\}/;
const TRANSPORT_PREFIXES: readonly RegExp[] = [
  /^Error invoking remote method '[^']*': /,
  /^(?:IpcError|Error): /,
  /^\[[A-Z_]+\] /,
  /^\{cause:[a-z-]+\} /,
];

export function ipcCauseTag(cause: IpcErrorCause): string {
  return `{cause:${cause}}`;
}

function isIpcErrorCause(value: string): value is IpcErrorCause {
  return (IPC_ERROR_CAUSES as readonly string[]).includes(value);
}

/** The cause main tagged on a failed IPC call, or null when there is none. */
export function readIpcErrorCause(err: unknown): IpcErrorCause | null {
  if (!(err instanceof Error)) return null;
  const tag = CAUSE_TAG_PATTERN.exec(err.message)?.[1];
  return tag !== undefined && isIpcErrorCause(tag) ? tag : null;
}

/**
 * Main's own message line of a failed IPC call, without Electron's and the
 * router's prefixes — what the user is shown when no known cause applies.
 * Main's error messages carry ids, refs, addresses and codes, never secret
 * values (secret text only ever travels in `config:set-secret` requests).
 */
export function ipcErrorText(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err);
  for (const prefix of TRANSPORT_PREFIXES) text = text.replace(prefix, '');
  return text;
}
