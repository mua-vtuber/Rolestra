/**
 * CLI Permission Parser — parses native CLI permission request events.
 *
 * Each CLI tool uses a different protocol for requesting user approval:
 * - Claude Code: stream-json line {"type":"permission_request",...}
 *
 * The parser detects these events in raw stdout lines, extracts the
 * structured data, and builds the corresponding response payload to
 * write back to the CLI's stdin.
 */

/** Parsed representation of a CLI-native permission request. */
export interface ParsedCliPermissionRequest {
  /** CLI-internal request identifier used to route the response. */
  cliRequestId: string;
  /** Tool or action name being requested (e.g. "Write", "Bash", "Edit"). */
  toolName: string;
  /** Target path, command, or resource string. */
  target: string;
  /** Optional description provided by the CLI. */
  description?: string;
  /** The original raw JSON line (retained for diagnostics). */
  rawLine: string;
}

/** Claude Code stream-json permission_request event shape. */
interface ClaudePermissionRequestEvent {
  type: 'permission_request';
  /** Tool name (e.g. "Write", "Bash"). */
  tool_name: string;
  /** Structured tool input — content varies by tool. */
  tool_input: Record<string, unknown>;
  /** CLI-internal request ID used for the permission_response. */
  id: string;
}

/**
 * Parser for Claude Code's stream-json permission_request events.
 *
 * Claude Code emits permission requests as JSON lines on stdout when the
 * user has not pre-approved the requested tool action. The Arena intercepts
 * these lines, presents an approval card to the user, and writes the
 * permission_response back to the process stdin.
 */
export class ClaudeCodePermissionParser {
  /**
   * Attempt to parse a single stdout line as a permission_request event.
   *
   * @returns Parsed request data, or null if the line is not a permission request.
   */
  tryParseLine(line: string): ParsedCliPermissionRequest | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null
    ) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    if (obj['type'] !== 'permission_request') {
      return null;
    }

    const event = obj as Partial<ClaudePermissionRequestEvent>;
    const id = typeof event.id === 'string' ? event.id : '';
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : 'Unknown';
    const toolInput = (typeof event.tool_input === 'object' && event.tool_input !== null)
      ? event.tool_input as Record<string, unknown>
      : {};

    // Extract the most relevant target from tool_input
    const target = this.extractTarget(toolInput);

    // Extract optional description
    const description = typeof toolInput['description'] === 'string'
      ? toolInput['description']
      : undefined;

    return {
      cliRequestId: id,
      toolName,
      target,
      description,
      rawLine: trimmed,
    };
  }

  /**
   * Build the permission_response JSON payload to write to the CLI's stdin.
   *
   * Format: {"type":"permission_response","id":"<cliRequestId>","allow":<bool>}\n
   */
  buildResponse(request: ParsedCliPermissionRequest, approved: boolean): string {
    return JSON.stringify({
      type: 'permission_response',
      id: request.cliRequestId,
      allow: approved,
    }) + '\n';
  }

  // ── Private helpers ────────────────────────────────────────

  /**
   * Extract the most meaningful target string from tool_input.
   *
   * Priority: path → command → url → first string value → JSON.stringify
   */
  private extractTarget(toolInput: Record<string, unknown>): string {
    for (const key of ['path', 'command', 'url', 'file_path', 'new_path', 'query']) {
      if (typeof toolInput[key] === 'string') {
        return toolInput[key] as string;
      }
    }
    // Fall back to first string value found
    for (const value of Object.values(toolInput)) {
      if (typeof value === 'string') return value;
    }
    // Last resort: serialize the whole input
    return JSON.stringify(toolInput);
  }
}
