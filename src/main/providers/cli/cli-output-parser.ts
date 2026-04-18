/**
 * CLI output parser — parses raw stdout data into text tokens.
 *
 * Handles stream-json, jsonl, and raw-stdout output formats.
 * Extracts text content from nested event objects (Claude, Codex, Gemini).
 * Also provides structured error extraction and output sampling.
 *
 * For stream-json format, the parser also intercepts permission_request
 * events emitted by Claude Code. These events are excluded from the
 * text output and returned separately so the caller can display an
 * approval card and respond via the CLI's stdin.
 */

import type { CliRuntimeConfig } from './cli-provider';
import { ClaudeCodePermissionParser, type ParsedCliPermissionRequest } from './cli-permission-parser';

/** Result of parseStreamJsonWithPermission. */
export interface StreamJsonParseResult {
  /** Text tokens to yield to the conversation stream. */
  tokens: string;
  /**
   * Parsed permission request if a permission_request event was found in
   * this chunk. Only one request is returned per chunk; additional requests
   * in the same chunk are logged and ignored (they are extremely rare).
   */
  permissionRequest: ParsedCliPermissionRequest | null;
}

export class CliOutputParser {
  private readonly claudePermissionParser = new ClaudeCodePermissionParser();

  /** Parse a raw stdout chunk into text tokens using the configured format. */
  parseOutputChunk(raw: string, config: CliRuntimeConfig): string {
    if (config.outputParser) {
      return config.outputParser(raw);
    }

    switch (config.outputFormat) {
      case 'stream-json':
        return this.parseStreamJson(raw);
      case 'jsonl':
        return this.parseJsonl(raw);
      case 'raw-stdout':
        return raw;
      default:
        return raw;
    }
  }

  /** Extract a structured error message from raw stdout (e.g., {"type":"error","message":"..."}). */
  extractStructuredError(raw: string): string | null {
    if (!raw) return null;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null) continue;
        const obj = parsed as Record<string, unknown>;
        if (obj.type === 'error' && typeof obj.message === 'string') {
          return obj.message;
        }
      } catch {
        // ignore invalid lines
      }
    }
    return null;
  }

  /** Build a truncated sample of raw output for error messages. */
  buildOutputSample(raw: string): string | null {
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (!compact) return null;
    return compact.slice(0, 300);
  }

  /**
   * Parse stream-json format while also intercepting permission_request events.
   *
   * Used by CliStreamer when the output format is stream-json (e.g. Claude Code).
   * Permission request lines are excluded from the returned tokens and returned
   * in the permissionRequest field instead.
   */
  parseStreamJsonWithPermission(raw: string): StreamJsonParseResult {
    const results: string[] = [];
    let permissionRequest: ParsedCliPermissionRequest | null = null;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for permission_request before general JSON parsing
      const req = this.claudePermissionParser.tryParseLine(trimmed);
      if (req !== null) {
        // Capture the first request; additional ones in the same chunk are unusual
        if (permissionRequest === null) {
          permissionRequest = req;
        } else {
          console.warn('[cli-output-parser] Multiple permission_request events in one chunk; only first is handled');
        }
        // Do not include this line in text output
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>;
          const extracted = this.extractTextFromEventObject(obj);
          if (extracted) results.push(extracted);
        }
      } catch {
        // Skip unparseable lines
      }
    }

    return { tokens: results.join(''), permissionRequest };
  }

  // ── Private format parsers ──────────────────────────────────

  /** Parse stream-json format (newline-delimited JSON with type/content fields). */
  private parseStreamJson(raw: string): string {
    const results: string[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>;
          const extracted = this.extractTextFromEventObject(obj);
          if (extracted) results.push(extracted);
        }
      } catch {
        // Skip unparseable lines
      }
    }

    return results.join('');
  }

  /** Parse JSONL format (one JSON object per line). */
  private parseJsonl(raw: string): string {
    const results: string[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>;
          const extracted = this.extractTextFromEventObject(obj);
          if (extracted) results.push(extracted);
        }
      } catch {
        // Skip unparseable lines
      }
    }

    return results.join('');
  }

  private extractTextFromEventObject(obj: Record<string, unknown>): string {
    const role = typeof obj.role === 'string' ? obj.role : '';
    const eventType = typeof obj.type === 'string' ? obj.type : '';
    const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';

    // Filter tool-related events (tool_use, tool_result, etc.)
    if (eventType.includes('tool') || role === 'tool') return '';
    if (subtype.includes('tool')) return '';
    if (eventType === 'thread.started' || eventType === 'turn.started' || eventType === 'error') {
      return '';
    }
    // Filter system/init events
    if (eventType === 'system') return '';

    // Check nested message role (Claude CLI wraps content in message.role)
    const msgObj = obj.message;
    if (typeof msgObj === 'object' && msgObj !== null) {
      const msgRole = (msgObj as Record<string, unknown>).role;
      if (msgRole === 'tool') return '';
    }

    // Codex JSONL often emits assistant text via:
    // { type: "item.completed", item: { type: "agent_message", text: "..." } }
    if (eventType === 'item.completed') {
      const item = obj.item;
      if (typeof item === 'object' && item !== null) {
        const itemObj = item as Record<string, unknown>;
        const itemType = typeof itemObj.type === 'string' ? itemObj.type : '';
        if (itemType === 'agent_message') {
          const text = this.extractAnyText(itemObj.text) || this.extractAnyText(itemObj.content);
          if (text) return text;
        }
      }
      return '';
    }

    // For assistant messages, extract only from text content blocks (skip tool_use blocks)
    if (eventType === 'assistant' && typeof msgObj === 'object' && msgObj !== null) {
      const content = (msgObj as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        return content
          .filter((block): block is Record<string, unknown> =>
            typeof block === 'object' && block !== null &&
            (block as Record<string, unknown>).type === 'text',
          )
          .map((block) => this.extractAnyText(block.text))
          .filter(Boolean)
          .join('');
      }
    }

    return this.extractAnyText(obj.content)
      || this.extractAnyText(obj.text)
      || this.extractAnyText(obj.output)
      || this.extractAnyText(obj.message)
      || this.extractAnyText(obj.delta)
      || this.extractAnyText(obj.data)
      || this.extractAnyText(obj.item)
      || '';
  }

  private extractAnyText(value: unknown): string {
    if (typeof value === 'string') return value;

    if (Array.isArray(value)) {
      const parts = value
        .map((item) => this.extractAnyText(item))
        .filter((part) => part.length > 0);
      return parts.join('');
    }

    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      return this.extractAnyText(record.text)
        || this.extractAnyText(record.content)
        || this.extractAnyText(record.value)
        || this.extractAnyText(record.output_text)
        || this.extractAnyText(record.delta)
        || this.extractAnyText(record.message)
        || '';
    }

    return '';
  }
}
