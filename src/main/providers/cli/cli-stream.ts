/**
 * CLI stream reader — reads stdout from child processes as async generators.
 *
 * Provides two reading strategies:
 * - readStdout: chunk-based reading for per-turn processes (stops on exit)
 * - readPersistentResponse: line-buffered reading with boundary detection
 *   for persistent processes (stops on response boundary, process stays alive)
 *
 * Both strategies integrate with CliOutputParser and CliSanitizer for
 * token processing, and use CliSessionState for hang timeout management.
 *
 * When the output format is stream-json (e.g. Claude Code), the streamer
 * also intercepts permission_request events and suspends the hang timer
 * while waiting for the user to respond via the onPermissionRequest callback.
 */

import type { ChildProcess } from 'node:child_process';
import type { CliRuntimeConfig } from './cli-provider';
import type { CliOutputParser } from './cli-output-parser';
import type { CliSanitizer } from './cli-sanitizer';
import type { CliSessionState } from './cli-session-state';
import { ClaudeCodePermissionParser, type ParsedCliPermissionRequest } from './cli-permission-parser';

/**
 * Optional callbacks for CLI stream events that require external coordination.
 */
export interface CliStreamerCallbacks {
  /**
   * Called when the CLI emits a permission_request event.
   *
   * The implementation should present an approval UI to the user and resolve
   * with true (approved) or false (rejected). The hang timer is suspended
   * for the duration of this call.
   *
   * The `stdin` parameter is the writable stream for the CLI process stdin.
   * The streamer will write the permission_response back to stdin after the
   * callback resolves; the callback itself does not need to do this.
   */
  onPermissionRequest?: (req: ParsedCliPermissionRequest) => Promise<boolean>;
}

export class CliStreamer {
  constructor(
    private readonly parser: CliOutputParser,
    private readonly sanitizer: CliSanitizer,
    private readonly sessionState: CliSessionState,
  ) {}

  /**
   * Read stdout chunks from a child process as an async generator.
   *
   * Used for per-turn processes and persistent fallback. Stops when
   * the process exits or the abort signal fires.
   *
   * When config.outputFormat is 'stream-json' and callbacks.onPermissionRequest
   * is provided, permission_request events are intercepted: the hang timer is
   * suspended, the callback is awaited, and the response is written to child.stdin.
   */
  async *readStdout(
    child: ChildProcess,
    config: CliRuntimeConfig,
    signal?: AbortSignal,
    callbacks?: CliStreamerCallbacks,
  ): AsyncGenerator<string> {
    if (!child.stdout) {
      return;
    }

    const stdout = child.stdout;
    let hangTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const cleanup = (): void => {
      if (hangTimer) {
        clearTimeout(hangTimer);
        hangTimer = null;
      }
      done = true;
    };

    // Create an async iterator from the stream events
    const chunks: string[] = [];
    let resolveWait: (() => void) | null = null;
    let rejectWait: ((err: Error) => void) | null = null;

    const resetHangTimer = (): void => {
      if (hangTimer) {
        clearTimeout(hangTimer);
      }
      const timeoutMs = this.sessionState.getHangTimeout(config);
      hangTimer = setTimeout(() => {
        cleanup();
        if (rejectWait) {
          rejectWait(
            new Error(
              `CLI response hang timeout (${config.command}, ${config.sessionStrategy}, ${timeoutMs}ms)`,
            ),
          );
        }
      }, timeoutMs);
    };

    stdout.setEncoding('utf-8');
    stdout.on('data', (chunk: string) => {
      chunks.push(chunk);
      resetHangTimer();
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
        rejectWait = null;
      }
    });

    child.on('exit', () => {
      cleanup();
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
        rejectWait = null;
      }
    });

    child.on('error', (err) => {
      cleanup();
      if (rejectWait) {
        rejectWait(err);
        resolveWait = null;
        rejectWait = null;
      }
    });

    // Start hang timer for first chunk
    resetHangTimer();

    try {
      while (!done || chunks.length > 0) {
        if (signal?.aborted) {
          return;
        }

        if (chunks.length === 0 && !done) {
          // Wait for data or completion
          await new Promise<void>((resolve, reject) => {
            resolveWait = resolve;
            rejectWait = reject;
          });
        }

        // Drain all available chunks
        while (chunks.length > 0) {
          const raw = chunks.shift();
          if (raw === undefined) break;

          // For stream-json format, intercept permission_request events
          if (
            config.outputFormat === 'stream-json' &&
            callbacks?.onPermissionRequest
          ) {
            const { tokens, permissionRequest } = this.parser.parseStreamJsonWithPermission(raw);
            const sanitized = this.sanitizer.sanitize(tokens);
            if (sanitized) yield sanitized;

            if (permissionRequest !== null) {
              // Suspend hang timer while waiting for user response
              if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }

              let approved = false;
              try {
                approved = await callbacks.onPermissionRequest(permissionRequest);
              } catch (err) {
                console.warn('[cli-stream] onPermissionRequest callback threw:', err);
              }

              // Write permission response to CLI stdin
              if (child.stdin && !child.stdin.destroyed) {
                const responsePayload = new ClaudeCodePermissionParser().buildResponse(permissionRequest, approved);
                child.stdin.write(responsePayload, (writeErr) => {
                  if (writeErr) console.warn('[cli-stream] stdin write for permission_response failed:', writeErr.message);
                });
              }

              // Resume hang timer
              if (!done) resetHangTimer();
            }
          } else {
            const parsed = this.parser.parseOutputChunk(raw, config);
            const sanitized = this.sanitizer.sanitize(parsed);
            if (sanitized) yield sanitized;
          }
        }
      }
      const flushed = this.sanitizer.sanitize('', true);
      if (flushed) yield flushed;
    } finally {
      cleanup();
    }
  }

  /**
   * Read persistent process stdout line-by-line with boundary detection.
   *
   * Unlike readStdout (chunk-based, stops on process exit), this method:
   * - Buffers partial lines for reliable JSON parsing
   * - Extracts session ID from response events
   * - Stops when responseBoundary matches (e.g., {"type":"result"})
   * - Properly removes event listeners (process stays alive between turns)
   *
   * When config.outputFormat is 'stream-json' and callbacks.onPermissionRequest
   * is provided, permission_request events are intercepted the same way as in
   * readStdout.
   */
  async *readPersistentResponse(
    proc: ChildProcess,
    config: CliRuntimeConfig,
    signal?: AbortSignal,
    callbacks?: CliStreamerCallbacks,
  ): AsyncGenerator<string> {
    if (!proc.stdout) return;

    const stdout = proc.stdout;
    let lineBuffer = '';
    let hangTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    let resolveWait: (() => void) | null = null;
    let rejectWait: ((err: Error) => void) | null = null;
    const pendingLines: string[] = [];

    const cleanup = (): void => {
      if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }
      done = true;
      stdout.removeListener('data', onData);
      proc.removeListener('exit', onExit);
      proc.removeListener('error', onError);
    };

    const resetHangTimer = (): void => {
      if (hangTimer) clearTimeout(hangTimer);
      const timeoutMs = this.sessionState.getHangTimeout(config);
      hangTimer = setTimeout(() => {
        cleanup();
        rejectWait?.(
          new Error(`CLI response hang timeout (${config.command}, persistent, ${timeoutMs}ms)`),
        );
      }, timeoutMs);
    };

    const onData = (chunk: string): void => {
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? ''; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) pendingLines.push(trimmed);
      }

      if (pendingLines.length > 0) {
        resetHangTimer();
        resolveWait?.();
        resolveWait = null;
        rejectWait = null;
      }
    };

    const onExit = (): void => {
      cleanup();
      resolveWait?.();
      resolveWait = null;
      rejectWait = null;
    };

    const onError = (err: Error): void => {
      cleanup();
      rejectWait?.(err);
      resolveWait = null;
      rejectWait = null;
    };

    stdout.setEncoding('utf-8');
    stdout.on('data', onData);
    proc.on('exit', onExit);
    proc.on('error', onError);

    resetHangTimer();

    try {
      while (!done || pendingLines.length > 0) {
        if (signal?.aborted) return;

        if (pendingLines.length === 0 && !done) {
          await new Promise<void>((resolve, reject) => {
            resolveWait = resolve;
            rejectWait = reject;
          });
        }

        while (pendingLines.length > 0) {
          const line = pendingLines.shift() as string;

          // Extract session ID
          if (config.extractSessionId) {
            const sid = config.extractSessionId(line);
            if (sid) this.sessionState.sessionId = sid;
          }

          // Check response boundary
          if (config.responseBoundary?.(line)) {
            return; // response complete
          }

          // For stream-json format, intercept permission_request events
          if (
            config.outputFormat === 'stream-json' &&
            callbacks?.onPermissionRequest
          ) {
            const { tokens, permissionRequest } = this.parser.parseStreamJsonWithPermission(line);
            const sanitized = this.sanitizer.sanitize(tokens);
            if (sanitized) yield sanitized;

            if (permissionRequest !== null) {
              // Suspend hang timer while waiting for user response
              if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }

              let approved = false;
              try {
                approved = await callbacks.onPermissionRequest(permissionRequest);
              } catch (err) {
                console.warn('[cli-stream] onPermissionRequest callback threw:', err);
              }

              // Write permission response to CLI stdin
              if (proc.stdin && !proc.stdin.destroyed) {
                const responsePayload = new ClaudeCodePermissionParser().buildResponse(permissionRequest, approved);
                proc.stdin.write(responsePayload, (writeErr) => {
                  if (writeErr) console.warn('[cli-stream] stdin write for permission_response failed:', writeErr.message);
                });
              }

              // Resume hang timer
              if (!done) resetHangTimer();
            }
          } else {
            const parsed = this.parser.parseOutputChunk(line, config);
            const sanitized = this.sanitizer.sanitize(parsed);
            if (sanitized) yield sanitized;
          }
        }
      }
      const flushed = this.sanitizer.sanitize('', true);
      if (flushed) yield flushed;
    } finally {
      cleanup();
    }
  }
}
