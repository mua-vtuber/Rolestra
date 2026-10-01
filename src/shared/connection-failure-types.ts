/**
 * Why an AI's connection check failed (QA Medium-1, 2026-10-01). Main
 * stores the last failure per AI (`MemberView.connectionFailure`) and the
 * settings AI tab translates the code — main never stores a sentence.
 * `detail` is a short technical token to search for (`HTTP 401`,
 * `ECONNREFUSED`, the missing model's name), never key text.
 *
 * - `key-missing`: the API key the AI points at is not stored.
 * - `auth`: the service rejected the key (HTTP 401 / 403).
 * - `http-error`: any other HTTP error from the service or local server.
 * - `network` / `timeout`: nothing reachable / no answer in time.
 * - `cli-not-found` / `cli-failed`: the CLI command is missing / could not run.
 * - `local-*`: the confirmed Ollama server — not running, not Ollama, an
 *   unreadable model list, no models, the AI's model missing, or an
 *   address that is not a URL.
 * - `probe-failed`: the check itself failed unexpectedly (detail: message).
 */
export type ConnectionFailureCode =
  | 'key-missing'
  | 'auth'
  | 'http-error'
  | 'network'
  | 'timeout'
  | 'cli-not-found'
  | 'cli-failed'
  | 'local-not-running'
  | 'local-not-ollama'
  | 'local-bad-model-list'
  | 'local-no-models'
  | 'local-model-missing'
  | 'local-invalid-endpoint'
  | 'probe-failed';

export interface ConnectionFailure {
  code: ConnectionFailureCode;
  detail: string | null;
}
