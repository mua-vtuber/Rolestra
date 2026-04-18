/**
 * Structured logging system with metrics.
 *
 * Lightweight, self-contained logger that outputs JSON-structured
 * log entries with performance metrics. No external dependencies
 * beyond Node.js built-ins.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LogLevel, LoggerConfig, StructuredLogEntry } from '../../shared/log-types';
import { DEFAULT_LOGGER_CONFIG, LOG_LEVEL_PRIORITY } from '../../shared/log-types';
import { maskSecrets } from './mask-secrets';

// ── Filter Types ──────────────────────────────────────────────────

/** Filters for querying buffered log entries. */
export interface LogEntryFilter {
  component?: string;
  result?: StructuredLogEntry['result'];
  startTime?: number;
  endTime?: number;
  level?: LogLevel;
}

// ── StructuredLogger ──────────────────────────────────────────────

/** Default maximum number of entries to keep in the ring buffer. */
const DEFAULT_MAX_BUFFER_SIZE = 10_000;

/**
 * Core structured logger.
 *
 * Emits JSON log entries to console and/or file. Maintains an
 * in-memory ring buffer for retrieval and export.
 */
export class StructuredLogger {
  private readonly config: LoggerConfig;
  private readonly buffer: StructuredLogEntry[] = [];
  private readonly maxBufferSize: number;
  private fileReady = false;

  constructor(config?: Partial<LoggerConfig>, maxBufferSize?: number) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.maxBufferSize = maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.ensureFileDirectory();
  }

  // ── Level Methods ─────────────────────────────────────────────

  /** Log a debug-level entry. */
  debug(entry: Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number }): void {
    this.emit('debug', entry);
  }

  /** Log an info-level entry. */
  info(entry: Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number }): void {
    this.emit('info', entry);
  }

  /** Log a warn-level entry. */
  warn(entry: Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number }): void {
    this.emit('warn', entry);
  }

  /** Log an error-level entry. */
  error(entry: Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number }): void {
    this.emit('error', entry);
  }

  // ── Convenience Methods ───────────────────────────────────────

  /** Log an AI provider response with latency and token metrics. */
  logProviderResponse(
    participantId: string,
    latencyMs: number,
    tokens: { input: number; output: number; total: number },
    result: StructuredLogEntry['result'],
  ): void {
    this.info({
      component: 'provider',
      action: 'response',
      result,
      participantId,
      latencyMs,
      tokenCount: tokens,
    });
  }

  /** Log a consensus state machine transition. */
  logConsensusTransition(
    previousState: string,
    newState: string,
    event: string,
  ): void {
    this.info({
      component: 'consensus',
      action: 'transition',
      result: 'success',
      consensusState: newState,
      metadata: { previousState, event },
    });
  }

  /** Log an execution service operation. */
  logExecution(
    operationId: string,
    action: string,
    result: StructuredLogEntry['result'],
    targetPath?: string,
  ): void {
    const level: LogLevel = result === 'failure' ? 'error' : 'info';
    this.emit(level, {
      component: 'execution',
      action,
      result,
      operationId,
      targetPath,
    });
  }

  /** Log a memory retrieval operation with duration metrics. */
  logMemoryRetrieval(
    query: string,
    resultCount: number,
    durationMs: number,
  ): void {
    this.info({
      component: 'memory',
      action: 'retrieval',
      result: 'success',
      latencyMs: durationMs,
      metadata: { query, resultCount },
    });
  }

  // ── Buffer Access ─────────────────────────────────────────────

  /** Return buffered entries, optionally filtered. */
  getEntries(filters?: LogEntryFilter): StructuredLogEntry[] {
    if (!filters) {
      return [...this.buffer];
    }

    return this.buffer.filter((entry) => {
      if (filters.component !== undefined && entry.component !== filters.component) {
        return false;
      }
      if (filters.result !== undefined && entry.result !== filters.result) {
        return false;
      }
      if (filters.startTime !== undefined && entry.timestamp < filters.startTime) {
        return false;
      }
      if (filters.endTime !== undefined && entry.timestamp > filters.endTime) {
        return false;
      }
      if (filters.level !== undefined && entry.level !== filters.level) {
        return false;
      }
      return true;
    });
  }

  /** Return the current number of buffered entries. */
  get entryCount(): number {
    return this.buffer.length;
  }

  /** Return the current logger configuration. */
  getConfig(): Readonly<LoggerConfig> {
    return this.config;
  }

  // ── Internal ──────────────────────────────────────────────────

  private emit(
    level: LogLevel,
    partial: Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number },
  ): void {
    // Level filtering
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.level]) {
      return;
    }

    const entry: StructuredLogEntry = {
      ...partial,
      level,
      timestamp: partial.timestamp ?? Date.now(),
    };

    // Strip stacks unless configured
    if (!this.config.includeStacks && entry.error?.stack) {
      const { stack: _, ...errorRest } = entry.error;
      void _;
      entry.error = errorRest as StructuredLogEntry['error'];
    }

    // Emit-time secret masking — redact credentials before buffer/output
    if (entry.error?.message) {
      entry.error = { ...entry.error, message: maskSecrets(entry.error.message) };
    }
    if (entry.error?.stack) {
      entry.error = { ...entry.error, stack: maskSecrets(entry.error.stack) };
    }
    if (entry.metadata && typeof entry.metadata === 'object') {
      entry.metadata = JSON.parse(maskSecrets(JSON.stringify(entry.metadata))) as Record<string, unknown>;
    }

    // Buffer management (ring buffer: evict oldest when full)
    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.splice(0, this.buffer.length - this.maxBufferSize + 1);
    }
    this.buffer.push(entry);

    // Output
    const json = JSON.stringify(entry);

    if (this.config.console) {
      this.writeToConsole(level, json);
    }

    if (this.config.file && this.fileReady) {
      this.writeToFile(json);
    }
  }

  private writeToConsole(level: LogLevel, json: string): void {
    switch (level) {
      case 'debug':
        console.debug(json);
        break;
      case 'info':
        console.info(json);
        break;
      case 'warn':
        console.warn(json);
        break;
      case 'error':
        console.error(json);
        break;
    }
  }

  private writeToFile(json: string): void {
    if (!this.config.file) return;
    try {
      appendFileSync(this.config.file.path, json + '\n', 'utf-8');
    } catch {
      // Silently ignore file write errors to avoid recursive logging
    }
  }

  private ensureFileDirectory(): void {
    if (!this.config.file) return;
    try {
      mkdirSync(dirname(this.config.file.path), { recursive: true });
      this.fileReady = true;
    } catch {
      // Cannot create directory; file logging disabled
      this.fileReady = false;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────

/** Create a configured StructuredLogger instance. */
export function createLogger(
  config?: Partial<LoggerConfig>,
  maxBufferSize?: number,
): StructuredLogger {
  return new StructuredLogger(config, maxBufferSize);
}
