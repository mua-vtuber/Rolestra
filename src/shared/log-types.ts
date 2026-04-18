/**
 * Structured logging type definitions.
 *
 * JSON-based structured log entries with metrics for
 * latency, tokens, errors, and retries.
 */

// ── Log Levels ─────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric priority for log level comparison. */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── Structured Log Entry ───────────────────────────────────────────

/** A structured log entry with metrics. */
export interface StructuredLogEntry {
  /** Log level. */
  level: LogLevel;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Request tracking ID. */
  requestId?: string;
  /** Conversation session ID. */
  conversationId?: string;
  /** Source component. */
  component: string;
  /** Action or operation name. */
  action: string;
  /** Outcome of the action. */
  result: 'success' | 'failure' | 'pending' | 'denied';

  // ── Performance Metrics ──────────────────────────────────────────
  /** Operation latency in milliseconds. */
  latencyMs?: number;
  /** Token usage for AI operations. */
  tokenCount?: {
    input: number;
    output: number;
    total: number;
  };

  // ── Error Info ───────────────────────────────────────────────────
  /** Error details (when result === 'failure'). */
  error?: {
    code: string;
    message: string;
    /** Stack trace (debug mode only). */
    stack?: string;
  };

  // ── Retry Info ───────────────────────────────────────────────────
  /** Current retry attempt (0-based). */
  retryCount?: number;
  /** Maximum retries allowed. */
  maxRetries?: number;

  // ── Context-Specific Fields ──────────────────────────────────────
  /** AI participant ID. */
  participantId?: string;
  /** Consensus state machine state. */
  consensusState?: string;
  /** Execution operation ID. */
  operationId?: string;
  /** File path target. */
  targetPath?: string;
  /** AI identifier for execution. */
  aiId?: string;

  /** Arbitrary additional data. */
  metadata?: Record<string, unknown>;
}

// ── Logger Config ──────────────────────────────────────────────────

/** Logger output configuration. */
export interface LoggerConfig {
  /** Minimum log level to emit. */
  level: LogLevel;
  /** Whether to include stack traces (typically debug only). */
  includeStacks: boolean;
  /** File output settings. */
  file?: {
    path: string;
    maxSizeMB: number;
    maxFiles: number;
  };
  /** Whether to also log to console. */
  console: boolean;
}

/** Default logger configuration. */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  includeStacks: false,
  console: true,
};

// ── Log Export ──────────────────────────────────────────────────────

/** Options for exporting logs. */
export interface LogExportOptions {
  format: 'markdown' | 'json';
  startTime?: number;
  endTime?: number;
  component?: string;
  result?: 'success' | 'failure' | 'denied';
  maskSecrets?: boolean;
}
