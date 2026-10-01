/**
 * What the AI add dialog learns about a local Ollama server
 * (`provider:detect-local`, spec 2026-10-01-messenger-redesign.md R6-3).
 *
 * Main resolves the address itself (settings → `OLLAMA_HOST` → default) and
 * reports exactly what answered. Every failure is its own status with a
 * cause code — never an empty model list. `detail` is a short technical
 * token for the user to search (`ECONNREFUSED`, `HTTP 404`), never a
 * sentence; the renderer translates the cause.
 *
 * - `running`: Ollama answered `/api/version` and `/api/tags` lists at least
 *   one model.
 * - `no-models`: Ollama answered, but no model is installed.
 * - `not-responding`: nothing answered — connection refused (not installed
 *   or not started), the time budget ran out, or the host could not be
 *   reached.
 * - `unrecognized`: something answered, but not as Ollama (`http-error`,
 *   `not-ollama`), or Ollama's model list could not be read
 *   (`bad-model-list`).
 * - `invalid-endpoint`: the configured address is not an http(s) URL.
 */

export type LocalAiNotRespondingCause = 'refused' | 'timeout' | 'unreachable';

export type LocalAiUnrecognizedCause = 'http-error' | 'not-ollama' | 'bad-model-list';

export type LocalAiDetection =
  | { status: 'running'; endpoint: string; version: string; models: string[] }
  | { status: 'no-models'; endpoint: string; version: string }
  | { status: 'not-responding'; endpoint: string; cause: LocalAiNotRespondingCause; detail: string | null }
  | { status: 'unrecognized'; endpoint: string; cause: LocalAiUnrecognizedCause; detail: string | null }
  | { status: 'invalid-endpoint'; endpoint: string };

export type LocalAiStatus = LocalAiDetection['status'];
