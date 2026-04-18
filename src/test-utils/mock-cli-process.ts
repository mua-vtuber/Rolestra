/**
 * Mock child_process utilities for CLI provider integration tests.
 *
 * Simulates ChildProcess objects with EventEmitter-based stdout/stderr,
 * controllable output injection, and hang simulation.
 */

import { EventEmitter } from 'node:events';

/** Options for configuring a mock child process. */
export interface MockChildProcessOptions {
  /** Exit code to emit when close event fires. Default: 0 */
  exitCode?: number;
  /** Whether the process should auto-close after all output. Default: true */
  autoClose?: boolean;
}

/** Lightweight mock ChildProcess with stdout/stderr as EventEmitters. */
export interface MockChildProcess {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  pid: number;
  kill: () => boolean;
  on: (event: string, cb: (...args: unknown[]) => void) => MockChildProcess;
  /** Emit 'close' event with exit code. */
  close: (code?: number) => void;
  /** Internal event emitter for process-level events. */
  _events: EventEmitter;
}

/** Create a mock ChildProcess with configurable behavior. */
export function mockChildProcess(options: MockChildProcessOptions = {}): MockChildProcess {
  const { exitCode = 0, autoClose = true } = options;

  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const processEvents = new EventEmitter();

  const proc: MockChildProcess = {
    stdout,
    stderr,
    killed: false,
    pid: Math.floor(Math.random() * 100_000) + 1000,
    kill() {
      this.killed = true;
      processEvents.emit('close', exitCode);
      return true;
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      processEvents.on(event, cb);
      return this;
    },
    close(code?: number) {
      processEvents.emit('close', code ?? exitCode);
    },
    _events: processEvents,
  };

  // Auto-close when stdout ends (if enabled)
  if (autoClose) {
    stdout.on('end', () => {
      setTimeout(() => proc.close(exitCode), 0);
    });
  }

  return proc;
}

/**
 * Inject lines into a mock process's stdout with optional delays.
 *
 * Each line is emitted as a 'data' event (Buffer).
 * After all lines, 'end' is emitted.
 */
export async function simulateCliOutput(
  proc: MockChildProcess,
  lines: string[],
  delays?: number[],
): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    const delayMs = delays?.[i] ?? 0;
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    proc.stdout.emit('data', Buffer.from(lines[i] + '\n'));
  }
  proc.stdout.emit('end');
}

/**
 * Simulate a hanging process that doesn't produce output
 * until the specified timeout elapses.
 *
 * Returns a cleanup function that forces the process to close.
 */
export function simulateHang(proc: MockChildProcess, timeoutMs: number): () => void {
  const timer = setTimeout(() => {
    proc.stdout.emit('end');
  }, timeoutMs);

  return () => {
    clearTimeout(timer);
    proc.close(1);
  };
}

/**
 * Inject lines into stderr with optional delays.
 */
export async function simulateStderr(
  proc: MockChildProcess,
  lines: string[],
  delays?: number[],
): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    const delayMs = delays?.[i] ?? 0;
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    proc.stderr.emit('data', Buffer.from(lines[i] + '\n'));
  }
}
