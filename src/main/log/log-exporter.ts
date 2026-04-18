/**
 * Log export functionality.
 *
 * Exports structured log entries as JSON or human-readable Markdown.
 * Includes optional secret masking for safe external sharing.
 */

import type { LogExportOptions, StructuredLogEntry } from '../../shared/log-types';
import type { StructuredLogger } from './structured-logger';

// ── Secret Masking ────────────────────────────────────────────────

/** Common API key prefixes and patterns to mask. */
const API_KEY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI keys (sk-...)
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: 'sk-***MASKED***' },
  // Anthropic keys (sk-ant-...)
  { pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g, replacement: 'sk-ant-***MASKED***' },
  // Google AI keys (AIza...)
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g, replacement: 'AIza***MASKED***' },
  // Generic Bearer tokens
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._-]{20,}\b/g, replacement: '$1***MASKED***' },
  // Generic long hex/base64 tokens (40+ chars, likely secrets)
  { pattern: /\b[A-Za-z0-9]{40,}\b/g, replacement: '***MASKED***' },
];

/**
 * Mask common API key patterns in text.
 *
 * Self-contained masking that does not depend on the config module
 * to keep the logging system independent.
 */
export function maskApiKeys(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of API_KEY_PATTERNS) {
    // Reset lastIndex for global regexes (they are stateful)
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

// ── LogExporter ───────────────────────────────────────────────────

/**
 * Exports log entries in JSON or Markdown format.
 */
export class LogExporter {
  private readonly logger: StructuredLogger;

  constructor(logger: StructuredLogger) {
    this.logger = logger;
  }

  /** Export filtered entries as a JSON string. */
  exportAsJson(options: LogExportOptions): string {
    const entries = this.getFilteredEntries(options);
    const output = options.maskSecrets
      ? entries.map((e) => JSON.parse(maskApiKeys(JSON.stringify(e))) as StructuredLogEntry)
      : entries;
    return JSON.stringify(output, null, 2);
  }

  /** Export filtered entries as human-readable Markdown. */
  exportAsMarkdown(options: LogExportOptions): string {
    const entries = this.getFilteredEntries(options);
    const lines: string[] = [];

    // ── Header ────────────────────────────────────────────────
    lines.push('# Log Export');
    lines.push('');

    if (entries.length === 0) {
      lines.push('No log entries found for the specified filters.');
      lines.push('');
      return lines.join('\n');
    }

    const firstTs = entries[0].timestamp;
    const lastTs = entries[entries.length - 1].timestamp;
    lines.push(`**Time Range:** ${formatTimestamp(firstTs)} -- ${formatTimestamp(lastTs)}`);
    lines.push(`**Total Entries:** ${entries.length}`);
    lines.push('');

    // ── Performance Summary ───────────────────────────────────
    lines.push('## Performance Summary');
    lines.push('');

    const latencies = entries
      .filter((e) => e.latencyMs !== undefined)
      .map((e) => e.latencyMs as number);

    const avgLatency = latencies.length > 0
      ? (latencies.reduce((sum, v) => sum + v, 0) / latencies.length).toFixed(1)
      : 'N/A';

    const totalTokens = entries.reduce((sum, e) => {
      return sum + (e.tokenCount?.total ?? 0);
    }, 0);

    const errorCount = entries.filter((e) => e.result === 'failure').length;

    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Avg Latency | ${avgLatency} ms |`);
    lines.push(`| Total Tokens | ${totalTokens} |`);
    lines.push(`| Error Count | ${errorCount} |`);
    lines.push('');

    // ── Event Timeline (grouped by component) ─────────────────
    lines.push('## Event Timeline');
    lines.push('');

    const byComponent = new Map<string, StructuredLogEntry[]>();
    for (const entry of entries) {
      const group = byComponent.get(entry.component) ?? [];
      group.push(entry);
      byComponent.set(entry.component, group);
    }

    for (const [component, componentEntries] of byComponent) {
      lines.push(`### ${component}`);
      lines.push('');

      for (const entry of componentEntries) {
        const ts = formatTimestamp(entry.timestamp);
        const entryLine = `- \`${ts}\` **[${entry.level.toUpperCase()}]** ${entry.action} -- ${entry.result}`;

        if (options.maskSecrets) {
          lines.push(maskApiKeys(entryLine));
        } else {
          lines.push(entryLine);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Internal ──────────────────────────────────────────────────

  private getFilteredEntries(options: LogExportOptions): StructuredLogEntry[] {
    return this.logger.getEntries({
      component: options.component,
      result: options.result,
      startTime: options.startTime,
      endTime: options.endTime,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/** Format a Unix-ms timestamp as an ISO string. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}
